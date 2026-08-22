import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/user';
import { leaderboardRouter } from './routes/leaderboard';
import { GameWebSocketServer } from './websocket/GameWebSocketServer';
import { initDatabase } from './db/database';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 中间件
app.use(cors({
  origin: '*', // 生产环境需要限制
  credentials: true,
}));
app.use(express.json({ limit: '10kb' })); // 修复: 限制请求体大小

// 请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// REST 路由
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/leaderboard', leaderboardRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// WebSocket 服务
const wsServer = new GameWebSocketServer(wss);

// 初始化数据库并启动服务器
const PORT = Number(process.env.PORT) || 60205;

async function main() {
  try {
    await initDatabase();
    console.log('[Database] 初始化完成');

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] 启动成功，端口: ${PORT}`);
      console.log(`[WebSocket] ws://0.0.0.0:${PORT}/ws`);
      console.log(`[HTTP API] http://0.0.0.0:${PORT}/api`);
    });
  } catch (error) {
    console.error('[Server] 启动失败:', error);
    process.exit(1);
  }
}

main();

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[Server] 正在关闭...');
  wsServer.close();
  server.close(() => {
    console.log('[Server] 已关闭');
    process.exit(0);
  });
});
