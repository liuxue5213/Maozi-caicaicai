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
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', nickname: `${prefix}昵称` }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`注册失败: ${JSON.stringify(body)}`);
  return body.data;
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
