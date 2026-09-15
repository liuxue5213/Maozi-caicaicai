/**
 * 人机对战"再来一局"卡住问题复现脚本（轮询版）。
 * 模拟真实客户端：连接后 AUTH + RECONNECT，对局中随机出拳，
 * 终局后在同一连接上连续再开多局；另有超时流（从不出拳）与断线重连流。
 *
 * 用法: node scripts/ai-repro.mjs <ws-url> <api-url> [variant]
 *   variant: rematch(默认) | neverpick | reconnect
 */
import WebSocket from 'ws';

const WS_URL = process.argv[2] || 'ws://localhost:61998/ws';
const API_URL = process.argv[3] || 'http://localhost:61998/api';
const VARIANT = process.argv[4] || 'rematch';

const rand = Math.random().toString(36).slice(2, 5);
const username = `rt${Date.now().toString(36)}${rand}`;
const reg = await fetch(`${API_URL}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: 'password123', nickname: '复现测试' }),
});
const regBody = await reg.json();
if (!regBody.success) { console.error('注册失败', JSON.stringify(regBody)); process.exit(1); }
const token = regBody.data.token;
console.log('注册成功', username);

const messages = [];

function makeSocket(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const sock = {
      ws, label,
      send(type, payload = {}) { ws.send(JSON.stringify({ type, payload })); },
      close(code = 1000) { clearInterval(pingTimer); try { ws.close(code, 'test'); } catch {} },
      terminate() { clearInterval(pingTimer); try { ws.terminate(); } catch {} },
    };
    // 模拟真实客户端心跳（每 15 秒 PING），否则 60 秒后被服务器心跳机制断开
    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) sock.send('PING');
    }, 15000);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      m._sock = label;
      messages.push(m);
    });
    ws.on('error', () => {});
    ws.once('close', (code) => console.log(`  [${label}] 连接关闭 code=${code}`));
    ws.once('open', () => resolve(sock));
    ws.once('error', reject);
  });
}

function findFrom(from, pred) {
  for (let i = from; i < messages.length; i++) {
    if (pred(messages[i])) return messages[i];
  }
  return null;
}

function trace(last = 25) {
  return messages.slice(-last)
    .map((m) => `${m._sock}:${m.type}${m.payload?.phase ? ':' + m.payload.phase : ''}`)
    .join(' ');
}

async function waitUntil(getter, timeout, desc) {
  const start = Date.now();
  for (;;) {
    const r = getter();
    if (r) return r;
    if (Date.now() - start > timeout) {
      throw new Error(`等待 ${desc} 超时 (${timeout}ms)。近期消息:\n  ${trace()}`);
    }
    await sleep(40);
  }
}

const CHOICES = ['ROCK', 'SCISSORS', 'PAPER'];
const pickRandom = () => CHOICES[Math.floor(Math.random() * 3)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 跟踪一局直到 GAME_OVER；pick=false 时全程挂机（走服务器超时随机出拳） */
async function playMatch(sock, label, base, { pick = true, maxRounds = 40 } = {}) {
  await waitUntil(() => findFrom(base, (m) => m._sock === sock.label && m.type === 'GAME_START'), 12000, `${label} GAME_START`);
  console.log(`  ${label}: 开局`);
  let cursor = base;
  for (let round = 1; round <= maxRounds; round++) {
    const msg = await waitUntil(
      () => findFrom(cursor, (m) => m._sock === sock.label && (
        m.type === 'GAME_OVER' || (m.type === 'PHASE_UPDATE' && m.payload?.phase === 'SELECTING'))),
      30000, `${label} 第${round}轮 SELECTING/GAME_OVER`);
    if (msg.type === 'GAME_OVER') {
      console.log(`  ${label}: GAME_OVER, 比分 ${msg.payload.finalScore.player}:${msg.payload.finalScore.opponent}`);
      return msg;
    }
    cursor = messages.indexOf(msg) + 1;
    if (pick) sock.send('MAKE_CHOICE', { choice: pickRandom() });
    const res = await waitUntil(
      () => findFrom(cursor, (m) => m._sock === sock.label && (m.type === 'ROUND_RESULT' || m.type === 'GAME_OVER')),
      30000, `${label} 第${round}轮 RESULT`);
    if (res.type === 'GAME_OVER') {
      console.log(`  ${label}: GAME_OVER, 比分 ${res.payload.finalScore.player}:${res.payload.finalScore.opponent}`);
      return res;
    }
    cursor = messages.indexOf(res) + 1;
  }
  throw new Error(`${label}: 超过最大轮数仍未结束`);
}

// ---- 变体1: 同一连接连续多局（模拟"再来一局"） ----
if (VARIANT === 'rematch') {
  const sock = await makeSocket('p1');
  sock.send('AUTH', { token });
  sock.send('RECONNECT', { token });
  await sleep(300);

  for (let gameNo = 1; gameNo <= 5; gameNo++) {
    console.log(`请求第${gameNo}局`);
    const base = messages.length;
    sock.send('START_AI_MATCH', { mode: 3, aiDifficulty: 'normal' });
    await playMatch(sock, `第${gameNo}局`, base);
    await sleep(200);
  }
  console.log('✅ 同连接连续 5 局人机对战全部正常');
  sock.close(1000);
}

// ---- 变体2: 从不出拳（全靠服务器超时随机）打完整局再连一局 ----
if (VARIANT === 'neverpick') {
  const sock = await makeSocket('np');
  sock.send('AUTH', { token });
  sock.send('RECONNECT', { token });
  await sleep(300);

  let base = messages.length;
  sock.send('START_AI_MATCH', { mode: 3, aiDifficulty: 'normal' });
  await playMatch(sock, '挂机局', base, { pick: false });
  base = messages.length;
  sock.send('START_AI_MATCH', { mode: 3, aiDifficulty: 'normal' });
  await playMatch(sock, '挂机后第2局', base, { pick: false });
  console.log('✅ 全超时流 2 局正常');
  sock.close(1000);
}

// ---- 变体3: 对局中断线重连 ----
if (VARIANT === 'reconnect') {
  let sock = await makeSocket('rc');
  sock.send('AUTH', { token });
  sock.send('RECONNECT', { token });
  await sleep(300);
  const base = messages.length;
  sock.send('START_AI_MATCH', { mode: 3, aiDifficulty: 'normal' });
  const sel = await waitUntil(
    () => findFrom(base, (m) => m._sock === 'rc' && m.type === 'PHASE_UPDATE' && m.payload?.phase === 'SELECTING'),
    15000, 'SELECTING');
  sock.send('MAKE_CHOICE', { choice: 'ROCK' });
  await waitUntil(() => findFrom(messages.indexOf(sel), (m) => m._sock === 'rc' && m.type === 'ROUND_RESULT'), 15000, 'ROUND_RESULT');
  console.log('  第1轮完成，异常断线...');
  sock.terminate();
  await sleep(500);

  sock = await makeSocket('rc2');
  sock.send('AUTH', { token });
  sock.send('RECONNECT', { token });
  const rec = await waitUntil(() => findFrom(0, (m) => m._sock === 'rc2' && m.type === 'RECONNECT_SUCCESS'), 10000, 'RECONNECT_SUCCESS');
  console.log('  重连恢复成功, 比分', rec.payload.playerScore, ':', rec.payload.opponentScore);
  await playMatch(sock, '重连后续局', messages.indexOf(rec), { pick: true });
  console.log('✅ 断线重连流正常');
  sock.close(1000);
}

process.exit(0);
