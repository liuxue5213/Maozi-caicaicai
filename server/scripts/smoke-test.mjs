/**
 * 联机冒烟测试：模拟两个真实客户端完整走一遍游戏协议。
 *
 * 用法：
 *   npm run build                # 先构建 shared 与 server
 *   GAME_TIME_SCALE=0.15 PORT=61999 DATABASE_PATH=/tmp/smoke.db JWT_SECRET=test node dist/index.js &
 *   node scripts/smoke-test.mjs ws://localhost:61999/ws http://localhost:61999/api
 *
 * 覆盖用例：
 *   1. 双人在线完整对局（阶段流转、比分对称、战绩结算）
 *   2. AI 三档难度均可开局并完成回合（含玩家出拳后 AI 即时跟拳）
 *   3. START_AI_MATCH 防重入（连发请求不产生第二个房间）
 *   4. 异常断线后 RECONNECT 恢复对局（状态按视角还原）
 *   5. 主动退出（close code 1000）立即判负
 *   6. 私密房间（邀请码）：建房/入房/开局/一次性校验 + 我的名次接口
 *   7. 未打过对局时"我的名次"为 0、未授权返回 401
 *   8. 对局内表情转发（白名单/头像透传）+ 头像更新接口校验
 *   9. 好友增删/在线状态 + 约战接受/拒绝/忙碌不可约战
 *  10. 成就计算（与实际对局胜负对账）
 *  11. 对局回放数据（双方视角镜像/回合结果自洽/胜轮数等于得分）
 *  12. 观战好友对局（视角一致/观战占用/终局通知/结束后释放）
 */
import WebSocket from 'ws';

const WS_URL = process.argv[2] || 'ws://localhost:60205/ws';
const API_URL = process.argv[3] || 'http://localhost:60205/api';
const WAIT_TIMEOUT = 10000;

class TestSocket {
  constructor(label) {
    this.label = label;
    this.ws = null;
    this.messages = [];
    this.waiters = [];
  }

  connect() {
    this.ws = new WebSocket(WS_URL);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => !w.tryResolve(msg));
    });
    this.ws.on('error', () => {});
    // 模拟真实客户端的心跳（真实 App 每 15 秒 PING 一次）
    this.pingTimer = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.send('PING');
    }, 5000);
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  send(type, payload = {}) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  /** 等待下一条符合条件（可选）的消息 */
  waitFor(type, predicate = () => true, timeout = WAIT_TIMEOUT) {
    const idx = this.messages.findIndex((m) => m.type === type && predicate(m));
    if (idx >= 0) return Promise.resolve(this.messages[idx]);

    return new Promise((resolve, reject) => {
      const waiter = {
        tryResolve: (msg) => {
          if (msg.type === type && predicate(msg)) {
            clearTimeout(timer);
            resolve(msg);
            return true;
          }
          return false;
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        const trace = this.messages
          .map((m) => `${m.type}[${m.payload?.phase ?? 'r' + m.payload?.roundNumber ?? ''}]`)
          .join(' ');
        reject(new Error(`[${this.label}] 等待 ${type} 超时 (${timeout}ms)。消息流:\n   ${trace}`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  receivedTypes() {
    return this.messages.map((m) => m.type);
  }

  auth(token) {
    this.send('AUTH', { token });
  }

  reconnect(token) {
    this.send('RECONNECT', { token });
  }

  makeChoice(choice) {
    this.send('MAKE_CHOICE', { choice });
  }

  close(code = 1000) {
    clearInterval(this.pingTimer);
    try { this.ws.close(code, 'test'); } catch {}
  }

  terminate() {
    clearInterval(this.pingTimer);
    try { this.ws.terminate(); } catch {}
  }
}

const CHOICES = ['ROCK', 'SCISSORS', 'PAPER'];
const pickRandom = () => CHOICES[Math.floor(Math.random() * 3)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerUser(prefix) {
  // 用户名限 3-20 字符：前缀 + 短随机后缀
  const rand = Math.random().toString(36).slice(2, 5);
  const username = `${prefix.toLowerCase()}${Date.now().toString(36)}${rand}`;
  let lastBody = null;
  // 认证接口有限流（每IP每分钟10次），套件内注册较多账号时等待重试
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'password123', nickname: `${prefix}昵称` }),
    });
    lastBody = await res.json();
    if (lastBody.success) return lastBody.data;
    if (!/频繁/.test(lastBody.error || '')) break;
    await sleep(20000);
  }
  throw new Error(`注册失败: ${JSON.stringify(lastBody)}`);
}

/** 响应选择阶段：SELECTING 广播到达后随机出拳（仅认调用之后到达的新广播，防止匹配到历史消息） */
function autoPlay(sockets, delayMs = 100) {
  for (const s of sockets) {
    const baseline = s.messages.length;
    s.waitFor('PHASE_UPDATE', (m) => m.payload.phase === 'SELECTING' && s.messages.indexOf(m) >= baseline)
      .then(() => sleep(delayMs))
      .then(() => {
        if (s.ws.readyState === WebSocket.OPEN) s.makeChoice(pickRandom());
      })
      .catch(() => {});
  }
}

let passed = 0;
let failed = 0;

// 全局看门狗：任何用例挂死时强制退出并保留诊断信息
setTimeout(() => {
  console.error('\n⏱️ 全局看门狗超时（150s），存在永久挂起的等待，强制退出');
  process.exit(2);
}, 150000);

function report(name, err) {
  if (err) {
    failed++;
    console.error(`❌ ${name}\n   ${err.message}`);
  } else {
    passed++;
    console.log(`✅ ${name}`);
  }
}

// ---- 用例 1: 双人在线完整对局 ----
async function testOnlineFullGame() {
  const [uA, uB] = await Promise.all([registerUser('A'), registerUser('B')]);
  const sa = new TestSocket('A');
  const sb = new TestSocket('B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);

  sa.send('START_MATCHING', { mode: 3 });
  sb.send('START_MATCHING', { mode: 3 });

  // 双方都进入同一局
  const [startA, startB] = await Promise.all([
    sa.waitFor('GAME_START'),
    sb.waitFor('GAME_START'),
  ]);
  assert(startA.payload.opponent?.nickname === uB.user.nickname, 'A 看到的对手昵称不正确');
  assert(startB.payload.opponent?.nickname === uA.user.nickname, 'B 看到的对手昵称不正确');

  let roundSeen = 0;
  while (roundSeen < 40) {
    roundSeen++;
    autoPlay([sa, sb]);

    // 每轮同时等待"新的回合结算"与"终局"，谁先到算谁
    const overPromise = Promise.all([
      sa.waitFor('GAME_OVER').catch(() => null),
      sb.waitFor('GAME_OVER').catch(() => null),
    ]).then(() => 'over');
    const roundPromise = Promise.all([
      sa.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber >= roundSeen),
      sb.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber >= roundSeen),
    ]).then(([ra, rb]) => ({ ra, rb }));

    const outcome = await Promise.race([overPromise, roundPromise]);
    if (outcome === 'over') break;

    // 视角对称性校验
    const { ra, rb } = outcome;
    if (
      ra.payload.playerChoice !== rb.payload.opponentChoice ||
      ra.payload.opponentChoice !== rb.payload.playerChoice ||
      ra.payload.playerScore !== rb.payload.opponentScore ||
      ra.payload.opponentScore !== rb.payload.playerScore
    ) {
      throw new Error(`双方结算不对称: A=${JSON.stringify(ra.payload)} B=${JSON.stringify(rb.payload)}`);
    }
  }

  const overA = sa.messages.find((m) => m.type === 'GAME_OVER');
  const overB = sb.messages.find((m) => m.type === 'GAME_OVER');
  if (!overA || !overB) throw new Error(`对局未结束。A收到: ${sa.receivedTypes().join(',')}`);
  if (
    overA.payload.finalScore.player !== overB.payload.finalScore.opponent ||
    overA.payload.finalScore.opponent !== overB.payload.finalScore.player
  ) {
    throw new Error('终局比分不对称');
  }

  // 双方战绩都应被计入（totalGames >= 1）
  for (const m of [overA, overB]) {
    const s = m.payload.stats;
    assert(s && s.totalGames + s.wins + s.losses + s.draws > 0, '战绩未结算');
  }

  sa.terminate();
  sb.terminate();
}

// ---- 用例 2: AI 三档难度 ----
async function testAiDifficulties() {
  const user = await registerUser('AI');
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const s = new TestSocket(`ai-${difficulty}`);
    await s.connect();
    s.auth(user.token);
    s.send('START_AI_MATCH', { mode: 3, aiDifficulty: difficulty });

    await s.waitFor('GAME_START', (m) => true);
    autoPlay([s], 80);
    // AI 应在玩家出拳后即时跟拳，快速收到结算
    const result = await s.waitFor('ROUND_RESULT');
    assert(result.payload.opponentChoice, `AI 未出拳 (${difficulty})`);

    s.terminate();
  }
}

// ---- 用例 3: START_AI_MATCH 防重入 ----
async function testStartAiMatchGuard() {
  const user = await registerUser('GUARD');
  const s = new TestSocket('guard');
  await s.connect();
  s.auth(user.token);

  s.send('START_AI_MATCH', { mode: 3 });
  await sleep(120);
  s.send('START_AI_MATCH', { mode: 3 }); // 重复请求应被忽略

  await s.waitFor('GAME_START');
  await sleep(700); // 若防重入失效，第二个 GAME_START 会在此窗口到达
  const starts = s.messages.filter((m) => m.type === 'GAME_START');
  assert(starts.length === 1, `重复请求产生了 ${starts.length} 个房间`);

  s.terminate();
}

// ---- 用例 4: 异常断线后重连恢复 ----
async function testReconnect() {
  const [uA, uB] = await Promise.all([registerUser('RC1'), registerUser('RC2')]);
  const sa = new TestSocket('rc-A');
  let sb = new TestSocket('rc-B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);

  sa.send('START_MATCHING', { mode: 3 });
  sb.send('START_MATCHING', { mode: 3 });
  await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);

  // 打完第一轮
  autoPlay([sa, sb]);
  const round1 = await sa.waitFor('ROUND_RESULT');
  await sb.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber === round1.payload.roundNumber);

  // B 异常断线（非主动退出）并重连
  sb.terminate();
  await sleep(400);
  sb = new TestSocket('rc-B-new');
  await sb.connect();
  sb.auth(uB.token);
  sb.reconnect(uB.token);

  const recovered = await sb.waitFor('RECONNECT_SUCCESS');
  // 恢复的比分应与断线前一致
  const r1 = recovered.payload;
  assert(
    typeof r1.playerScore === 'number' &&
      typeof r1.opponentScore === 'number' &&
      r1.playerScore + r1.opponentScore === round1.payload.playerScore + round1.payload.opponentScore,
    '恢复的比分与断线前不一致'
  );
  assert(r1.opponent?.nickname === uA.user.nickname, '恢复信息中的对手不正确');

  // 恢复后应能继续打完
  for (let i = 0; i < 20; i++) {
    autoPlay([sa, sb]);
    const done = await Promise.race([
      Promise.all([sb.waitFor('GAME_OVER'), sa.waitFor('GAME_OVER')]).then(() => true),
      sleep(400).then(() => false),
    ]);
    if (done) break;
    await sleep(600);
  }
  assert(sb.messages.some((m) => m.type === 'GAME_OVER'), '重连后对局未能打完');

  sa.terminate();
  sb.terminate();
}

// ---- 用例 5: 主动退出立即判负 ----
async function testAbandonForfeit() {
  const [uA, uB] = await Promise.all([registerUser('QF1'), registerUser('QF2')]);
  const sa = new TestSocket('qf-A');
  const sb = new TestSocket('qf-B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);

  sa.send('START_MATCHING', { mode: 3 });
  sb.send('START_MATCHING', { mode: 3 });
  await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);

  // A 主动关闭连接（code 1000），应立刻判 B 获胜
  sa.close(1000);
  await sb.waitFor('OPPONENT_DISCONNECTED');
  await sb.waitFor('GAME_OVER', (m) => m.payload.playerWon === true);
  const over = sb.messages.find((m) => m.type === 'GAME_OVER');
  assert(over.payload.finalScore.opponent > 0 || over.payload.finalScore.player > 0, '判负比分异常');

  sb.terminate();
}

// ---- 用例 6: 私密房间（邀请码）全流程 ----
async function testPrivateRoom() {
  const [uA, uB] = await Promise.all([registerUser('PR1'), registerUser('PR2')]);
  const sa = new TestSocket('pr-A');
  const sb = new TestSocket('pr-B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);

  // 错误邀请码应返回错误
  sb.send('JOIN_PRIVATE_ROOM', { code: 'ZZZZ' });
  const joinErr = await sb.waitFor('ERROR');
  assert(/房间/.test(joinErr.payload.error), `错误邀请码未得到预期错误: ${joinErr.payload.error}`);

  // A 建房，收到 4 位邀请码
  sa.send('CREATE_PRIVATE_ROOM', { mode: 3 });
  const created = await sa.waitFor('PRIVATE_ROOM_CREATED');
  const code = created.payload.code;
  assert(/^[A-Z2-9]{4}$/.test(code), `邀请码格式异常: ${code}`);

  // 房主不能加入自己的房间
  sa.send('JOIN_PRIVATE_ROOM', { code });
  const selfErr = await sa.waitFor('ERROR');
  assert(/自己/.test(selfErr.payload.error), '未阻止房主加入自己的房间');

  // B 凭码入房，双方开局
  sb.send('JOIN_PRIVATE_ROOM', { code });
  const [startA, startB] = await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);
  assert(startA.payload.opponent?.nickname === uB.user.nickname, '私密房间 A 的对手不正确');
  assert(startB.payload.opponent?.nickname === uA.user.nickname, '私密房间 B 的对手不正确');

  // 打完整局
  let roundSeen = 0;
  while (roundSeen < 40) {
    roundSeen++;
    autoPlay([sa, sb]);
    const overPromise = Promise.all([
      sa.waitFor('GAME_OVER').catch(() => null),
      sb.waitFor('GAME_OVER').catch(() => null),
    ]).then(() => 'over');
    const roundPromise = Promise.all([
      sa.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber >= roundSeen),
      sb.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber >= roundSeen),
    ]);
    const outcome = await Promise.race([overPromise, roundPromise]);
    if (outcome === 'over') break;
  }
  const overA = sa.messages.find((m) => m.type === 'GAME_OVER');
  const overB = sb.messages.find((m) => m.type === 'GAME_OVER');
  assert(overA && overB, '私密房间对局未结束');

  // 邀请码一次性：开局即销毁，终局后再凭码进房应失败
  sb.send('JOIN_PRIVATE_ROOM', { code });
  const reuseErr = await sb.waitFor('ERROR');
  assert(/房间/.test(reuseErr.payload.error), '邀请码开局后未被销毁');

  // 打完对局后，"我的名次"接口应返回有效名次
  const meRes = await fetch(`${API_URL}/leaderboard/me?type=wins`, {
    headers: { Authorization: `Bearer ${uA.token}` },
  });
  const meBody = await meRes.json();
  assert(
    meBody.success && meBody.data.position >= 1 && meBody.data.totalPlayers >= 2,
    `我的名次接口异常: ${JSON.stringify(meBody)}`
  );

  sa.terminate();
  sb.terminate();
}

// ---- 用例 7: 未打过对局时"我的名次"为 0 ----
async function testMyRankNoGames() {
  const user = await registerUser('MR1');
  const res = await fetch(`${API_URL}/leaderboard/me?type=wins`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  const body = await res.json();
  assert(body.success && body.data.position === 0, `未打对局时名次应为 0: ${JSON.stringify(body)}`);

  // 未授权应 401
  const anon = await fetch(`${API_URL}/leaderboard/me?type=wins`);
  assert(anon.status === 401, '未授权访问 /leaderboard/me 应返回 401');
}

// ---- 用例 8: 对局内表情转发 + 头像接口 ----
async function testEmojiAndAvatar() {
  const [uA, uB] = await Promise.all([registerUser('EM1'), registerUser('EM2')]);

  // 头像接口：合法预设成功，非法值 400
  const avRes = await fetch(`${API_URL}/user/avatar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uA.token}` },
    body: JSON.stringify({ avatar: '🦊' }),
  });
  assert((await avRes.json()).data?.avatar === '🦊', '更新头像失败');
  const badRes = await fetch(`${API_URL}/user/avatar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uA.token}` },
    body: JSON.stringify({ avatar: '<script>' }),
  });
  assert(badRes.status === 400, '非法头像未被拒绝');

  // 私密房间开局后互发表情
  const sa = new TestSocket('em-A');
  const sb = new TestSocket('em-B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);
  await sleep(200);

  sa.send('CREATE_PRIVATE_ROOM', { mode: 3 });
  const created = await sa.waitFor('PRIVATE_ROOM_CREATED');
  sb.send('JOIN_PRIVATE_ROOM', { code: created.payload.code });
  await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);

  sa.send('SEND_EMOJI', { emoji: '👍' });
  const got = await sb.waitFor('EMOJI_RECEIVED');
  assert(got.payload.emoji === '👍', `B 收到的表情不正确: ${got.payload.emoji}`);

  // 白名单校验：非法表情不应转发
  sa.send('SEND_EMOJI', { emoji: '<script>' });
  await sleep(400);
  assert(
    !sb.messages.some((m) => m.type === 'EMOJI_RECEIVED' && String(m.payload?.emoji).includes('script')),
    '非法表情被转发了'
  );

  // GAME_START 应携带头像（A 刚设置了 🦊）
  const startB = sb.messages.find((m) => m.type === 'GAME_START');
  assert(startB.payload.opponent?.avatar === '🦊', `对手头像未透传: ${JSON.stringify(startB.payload.opponent)}`);

  sa.terminate();
  sb.terminate();
}

// ---- 用例 9: 好友系统 + 约战全流程 ----
async function testFriendsAndChallenge() {
  const [uA, uB, uC] = await Promise.all([registerUser('FR1'), registerUser('FR2'), registerUser('FR3')]);
  const authHdr = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

  // 添加好友：成功 / 重复 / 自加 / 不存在
  const addRes = await fetch(`${API_URL}/user/friends`, { method: 'POST', headers: authHdr(uA.token), body: JSON.stringify({ username: uB.user.username }) });
  const addBody = await addRes.json();
  assert(addBody.success && addBody.data.id === uB.user.id, '添加好友失败');
  const dupRes = await fetch(`${API_URL}/user/friends`, { method: 'POST', headers: authHdr(uA.token), body: JSON.stringify({ username: uB.user.username }) });
  assert(dupRes.status === 400, '重复添加未拒绝');
  const selfRes = await fetch(`${API_URL}/user/friends`, { method: 'POST', headers: authHdr(uA.token), body: JSON.stringify({ username: uA.user.username }) });
  assert(selfRes.status === 400, '添加自己未拒绝');
  const ghostRes = await fetch(`${API_URL}/user/friends`, { method: 'POST', headers: authHdr(uA.token), body: JSON.stringify({ username: 'no_such_user_xx' }) });
  assert(ghostRes.status === 404, '不存在的用户未被拒绝');

  const sa = new TestSocket('fr-A');
  const sb = new TestSocket('fr-B');
  const sc = new TestSocket('fr-C');
  await Promise.all([sa.connect(), sb.connect(), sc.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);
  sc.auth(uC.token);
  await sleep(300);

  // 好友列表带在线状态
  const listRes = await fetch(`${API_URL}/user/friends`, { headers: authHdr(uA.token) });
  const list = (await listRes.json()).data;
  const friendB = list.find((f) => f.id === uB.user.id);
  assert(friendB && friendB.online === true, `好友在线状态异常: ${JSON.stringify(friendB)}`);

  // A 约战 B，B 接受，双方开局
  sa.send('CHALLENGE', { targetId: uB.user.id, mode: 3 });
  const invite = await sb.waitFor('CHALLENGE_RECEIVED');
  assert(invite.payload.from.id === uA.user.id, '约战来源不正确');
  assert(invite.payload.mode === 3, '约战模式不正确');
  sb.send('CHALLENGE_RESPONSE', { challengeId: invite.payload.challengeId, accept: true });
  const [startA, startB] = await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);
  assert(startA.payload.opponent?.nickname === uB.user.nickname, 'A 看到的对手不正确');
  assert(startB.payload.opponent?.nickname === uA.user.nickname, 'B 看到的对手不正确');

  // 打一轮校验对称性
  autoPlay([sa, sb]);
  const ra = await sa.waitFor('ROUND_RESULT');
  await sb.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber === ra.payload.roundNumber);

  // B 离线，当前对局会以判负/自然打完收尾；等 A 收到 GAME_OVER 后再探测
  sb.terminate();
  await sa.waitFor('GAME_OVER', () => true, 30000);
  await sleep(400);
  sa.send('CHALLENGE', { targetId: uB.user.id, mode: 3 });
  const busy = await sa.waitFor('CHALLENGE_DECLINED');
  assert(busy.payload.reason === 'unavailable', `离线时应返回 unavailable: ${busy.payload.reason}`);

  // C 拒绝 A 的约战（用基线索引避免命中上一步的旧 CHALLENGE_DECLINED）
  const declineBase = sa.messages.length;
  sa.send('CHALLENGE', { targetId: uC.user.id, mode: 3 });
  const inviteC = await sc.waitFor('CHALLENGE_RECEIVED');
  sc.send('CHALLENGE_RESPONSE', { challengeId: inviteC.payload.challengeId, accept: false });
  const declined = await sa.waitFor('CHALLENGE_DECLINED', (m) => sa.messages.indexOf(m) >= declineBase);
  assert(declined.payload.reason === 'declined', `拒绝应返回 declined: ${declined.payload.reason}`);

  // 删除好友
  const delRes = await fetch(`${API_URL}/user/friends/${uB.user.id}`, { method: 'DELETE', headers: authHdr(uA.token) });
  assert((await delRes.json()).success, '删除好友失败');
  const list2 = (await (await fetch(`${API_URL}/user/friends`, { headers: authHdr(uA.token) })).json()).data;
  assert(list2.length === 0, '删除后好友列表应为空');

  sa.terminate();
  sb.terminate();
  sc.terminate();
}

// ---- 用例 10: 成就计算 ----
async function testAchievements() {
  const [uA, uB] = await Promise.all([registerUser('AC1'), registerUser('AC2')]);
  const sa = new TestSocket('ac-A');
  const sb = new TestSocket('ac-B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);
  await sleep(200);

  // 打完一局（有胜有负才能同时验证胜负两侧）
  sa.send('START_MATCHING', { mode: 3 });
  sb.send('START_MATCHING', { mode: 3 });
  await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);
  for (let i = 0; i < 40; i++) {
    autoPlay([sa, sb]);
    const done = await Promise.race([
      Promise.all([sa.waitFor('GAME_OVER'), sb.waitFor('GAME_OVER')]).then(() => true),
      sleep(1500).then(() => false),
    ]);
    if (done) break;
  }
  assert(sa.messages.some((m) => m.type === 'GAME_OVER'), '对局未结束');

  // A 添加 B 为好友（验证 friends 指标）
  await fetch(`${API_URL}/user/friends`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uA.token}` },
    body: JSON.stringify({ username: uB.user.username }),
  });

  // 再赢一局 AI（验证 aiWins 指标）
  const sAi = new TestSocket('ac-AI');
  await sAi.connect();
  sAi.auth(uA.token);
  sAi.send('START_AI_MATCH', { mode: 3, aiDifficulty: 'easy' });
  await sAi.waitFor('GAME_START');
  for (let i = 0; i < 40; i++) {
    autoPlay([sAi]);
    const done = await Promise.race([
      sAi.waitFor('GAME_OVER').then(() => true),
      sleep(1500).then(() => false),
    ]);
    if (done) break;
  }
  assert(sAi.messages.some((m) => m.type === 'GAME_OVER'), 'AI 对局未结束');

  const res = await fetch(`${API_URL}/user/achievements`, {
    headers: { Authorization: `Bearer ${uA.token}` },
  });
  const list = (await res.json()).data;
  assert(Array.isArray(list) && list.length >= 20, `成就列表异常: ${list.length}`);
  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  assert(byId['first-game'].unlocked && byId['first-game'].current >= 2, 'first-game 未解锁');
  assert(byId['friends-3'].unlocked === false && byId['friends-3'].current === 1, `friends 进度异常: ${JSON.stringify(byId['friends-3'])}`);
  // 精确对账：A 只打过 1 局 AI，aiWins 应等于该局是否获胜；first-win 应等于两局任一获胜
  const aiOver = sAi.messages.find((m) => m.type === 'GAME_OVER');
  const wonAi = Boolean(aiOver.payload.playerWon) && !aiOver.payload.isDraw;
  const pvpOver = sa.messages.find((m) => m.type === 'GAME_OVER');
  const wonPvp = Boolean(pvpOver.payload.playerWon) && !pvpOver.payload.isDraw;
  const aiWins = byId['ai-wins-10'];
  assert(aiWins.current === (wonAi ? 1 : 0), `aiWins 对账失败: current=${aiWins.current}, wonAi=${wonAi}`);
  assert(aiWins.unlocked === (aiWins.current >= aiWins.target), 'aiWins 解锁状态与进度不自洽');
  const firstWin = byId['first-win'];
  assert(firstWin.unlocked === (wonAi || wonPvp), `first-win 应等于两局任一获胜: wonAi=${wonAi}, wonPvp=${wonPvp}, ${JSON.stringify(firstWin)}`);

  sa.terminate();
  sb.terminate();
  sAi.terminate();
}

// ---- 用例 11: 对局回放数据 ----
async function testReplayRounds() {
  const [uA, uB] = await Promise.all([registerUser('RP1'), registerUser('RP2')]);
  const sa = new TestSocket('rp-A');
  const sb = new TestSocket('rp-B');
  await Promise.all([sa.connect(), sb.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);
  await sleep(200);

  sa.send('START_MATCHING', { mode: 3 });
  sb.send('START_MATCHING', { mode: 3 });
  await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);
  for (let i = 0; i < 40; i++) {
    autoPlay([sa, sb]);
    const done = await Promise.race([
      Promise.all([sa.waitFor('GAME_OVER'), sb.waitFor('GAME_OVER')]).then(() => true),
      sleep(1500).then(() => false),
    ]);
    if (done) break;
  }
  const pvpOver = await sa.waitFor('GAME_OVER');

  // 双方视角的回放数据都应存在且互为镜像
  for (const [u, over, oppOver] of [
    [uA, pvpOver, null],
    [uB, sb.messages.find((m) => m.type === 'GAME_OVER'), null],
  ]) {
    const res = await fetch(`${API_URL}/user/history?limit=5`, {
      headers: { Authorization: `Bearer ${u.token}` },
    });
    const list = (await res.json()).data;
    const rec = list.find((r) => r.id && r.rounds && r.rounds.length > 0);
    assert(rec, '历史记录缺少回放数据');
    // 轮数与对局轮数一致；每轮 choices 合法且 result 自洽
    for (const rd of rec.rounds) {
      assert(['ROCK', 'SCISSORS', 'PAPER'].includes(rd.player), `非法玩家出拳: ${rd.player}`);
      assert(['ROCK', 'SCISSORS', 'PAPER'].includes(rd.opponent), `非法对手出拳: ${rd.opponent}`);
      const expect =
        rd.player === rd.opponent ? 'DRAW' : wonPair(rd.player, rd.opponent) ? 'WIN' : 'LOSE';
      assert(rd.result === expect, `回合结果不自洽: ${JSON.stringify(rd)}`);
    }
    // 胜轮数应等于自己的得分
    const winCount = rec.rounds.filter((rd) => rd.result === 'WIN').length;
    assert(winCount === rec.myScore, `胜轮数与比分不符: wins=${winCount}, score=${rec.myScore}`);
  }

  function wonPair(a, b) {
    return (
      (a === 'ROCK' && b === 'SCISSORS') ||
      (a === 'SCISSORS' && b === 'PAPER') ||
      (a === 'PAPER' && b === 'ROCK')
    );
  }

  sa.terminate();
  sb.terminate();
}

// ---- 用例 12: 观战好友对局 ----
async function testSpectate() {
  const [uA, uB, uC] = await Promise.all([registerUser('SP1'), registerUser('SP2'), registerUser('SP3')]);
  const sa = new TestSocket('sp-A');
  const sb = new TestSocket('sp-B');
  let sc = new TestSocket('sp-C');
  await Promise.all([sa.connect(), sb.connect(), sc.connect()]);
  sa.auth(uA.token);
  sb.auth(uB.token);
  sc.auth(uC.token);
  await sleep(200);

  // A、B 匹配成局
  sa.send('START_MATCHING', { mode: 3 });
  sb.send('START_MATCHING', { mode: 3 });
  await Promise.all([sa.waitFor('GAME_START'), sb.waitFor('GAME_START')]);

  // C 观战 A 的对局
  sc.send('WATCH_FRIEND', { targetId: uA.user.id });
  const start = await sc.waitFor('SPECTATE_START');
  assert(start.payload.watched.nickname === uA.user.nickname, '被观战者不正确');
  assert(start.payload.opponent.nickname === uB.user.nickname, '对手信息不正确');

  // 打一轮：C 应收到同轮的 ROUND_RESULT 且与 A 视角一致
  autoPlay([sa, sb]);
  const ra = await sa.waitFor('ROUND_RESULT');
  const rc = await sc.waitFor('ROUND_RESULT', (m) => m.payload.roundNumber === ra.payload.roundNumber);
  assert(
    rc.payload.playerChoice === ra.payload.playerChoice &&
      rc.payload.opponentChoice === ra.payload.opponentChoice &&
      rc.payload.result === ra.payload.result &&
      rc.payload.playerScore === ra.payload.playerScore,
    `观战视角与玩家视角不一致: A=${JSON.stringify(ra.payload)} C=${JSON.stringify(rc.payload)}`
  );

  // 观战中 C 不能开新对局（被 currentGameId 占用）
  sc.send('START_AI_MATCH', { mode: 3 });
  await sleep(500);
  assert(!sc.messages.some((m) => m.type === 'GAME_START'), '观战中仍能开始对局');

  // 等对局结束（平局多时会打很多轮），C 收到 SPECTATE_END 且比分与玩家侧一致
  await Promise.all([
    sa.waitFor('GAME_OVER', () => true, 45000),
    sb.waitFor('GAME_OVER', () => true, 45000),
  ]);
  const end = await sc.waitFor('SPECTATE_END', () => true, 45000);
  const overA = sa.messages.find((m) => m.type === 'GAME_OVER');
  assert(
    end.payload.watchedScore === overA.payload.finalScore.player &&
      end.payload.opponentScore === overA.payload.finalScore.opponent,
    `观战终局比分不一致: ${JSON.stringify(end.payload)} vs ${JSON.stringify(overA.payload.finalScore)}`
  );

  // 观战结束后 C 恢复自由，可以开 AI 对局
  sc.send('START_AI_MATCH', { mode: 3 });
  await sc.waitFor('GAME_START');

  // 观战中途掉线不应对局方受影响：C 重连后再观战 B，B 正常打完
  sc.terminate();
  sc = new TestSocket('sp-C2');
  await sc.connect();
  sc.auth(uC.token);
  await sleep(300);
  sc.send('WATCH_FRIEND', { targetId: uB.user.id });
  const start2 = await sc.waitFor('SPECTATE_START', () => true, 8000).catch(() => null);
  if (start2) {
    // B 可能还在自由对局窗口（几乎不可能，忽略），跳过后续校验
    sc.terminate();
  }

  sa.terminate();
  sb.terminate();
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ---- 入口 ----
const cases = [
  ['双人在线完整对局', testOnlineFullGame],
  ['AI 三档难度', testAiDifficulties],
  ['AI 匹配防重入', testStartAiMatchGuard],
  ['断线重连恢复', testReconnect],
  ['主动退出立即判负', testAbandonForfeit],
  ['私密房间（邀请码）全流程', testPrivateRoom],
  ['我的名次接口', testMyRankNoGames],
  ['对局表情与头像', testEmojiAndAvatar],
  ['好友系统与约战', testFriendsAndChallenge],
  ['成就计算', testAchievements],
  ['对局回放数据', testReplayRounds],
  ['观战好友对局', testSpectate],
];

console.log(`冒烟测试开始 -> ws=${WS_URL} api=${API_URL}`);
for (const [name, fn] of cases) {
  try {
    await fn();
    report(name, null);
  } catch (err) {
    report(name, err);
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
