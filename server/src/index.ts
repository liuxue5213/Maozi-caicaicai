import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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

// CORS 配置：根据环境变量限制来源
const corsOrigins = process.env.CORS_ORIGINS;
const corsOptions = corsOrigins
  ? {
      origin: corsOrigins.split(',').map(s => s.trim()),
      credentials: true,
    }
  : process.env.NODE_ENV === 'production'
    ? { origin: [], credentials: true } // 生产环境默认不允许任何来源
    : { origin: '*', credentials: true }; // 开发环境允许所有

app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));

// 请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// 速率限制：认证接口每IP每分钟最多10次
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 10,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 通用API速率限制：每IP每分钟最多60次
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// REST 路由
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/user', apiLimiter, userRouter);
app.use('/api/leaderboard', apiLimiter, leaderboardRouter);

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
