import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { signToken, verifyToken } from '../utils/jwt';

export const authRouter = Router();

// 注册
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, nickname } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, error: '用户名和密码不能为空' });
      return;
    }

    if (username.length < 3 || username.length > 20) {
      res.status(400).json({ success: false, error: '用户名长度应为 3-20 个字符' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, error: '密码长度至少 6 位' });
      return;
    }

    // 检查用户名是否已存在
    if (db.findUserByUsername(username)) {
      res.status(409).json({ success: false, error: '用户名已被注册' });
      return;
    }

    // 创建用户
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const finalNickname = nickname || username;

    db.createUser({
      id: userId,
      username,
      passwordHash,
      nickname: finalNickname,
      avatar: null,
      createdAt: Date.now(),
    });

    db.createStats(userId);

    const token = signToken({ userId, username });
    const stats = db.getStats(userId)!;

    res.json({
      success: true,
      data: {
        user: {
          id: userId,
          username,
          nickname: finalNickname,
          avatar: null,
          createdAt: new Date().toISOString(),
        },
        token,
        stats,
      },
    });
  } catch (error) {
    console.error('[Auth] 注册失败:', error);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 登录
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, error: '用户名和密码不能为空' });
      return;
    }

    const user = db.findUserByUsername(username);
    if (!user) {
      res.status(401).json({ success: false, error: '用户名或密码错误' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      res.status(401).json({ success: false, error: '用户名或密码错误' });
      return;
    }

    const token = signToken({ userId: user.id, username: user.username });
    let stats = db.getStats(user.id);
    if (!stats) stats = db.createStats(user.id);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          avatar: user.avatar,
          createdAt: new Date(user.createdAt).toISOString(),
        },
        token,
        stats,
      },
    });
  } catch (error) {
    console.error('[Auth] 登录失败:', error);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 验证 Token
authRouter.get('/verify', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未授权' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Token 无效或已过期' });
    return;
  }

  const user = db.findUserById(payload.userId);
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' });
    return;
  }

  const stats = db.getStats(user.id);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        createdAt: new Date(user.createdAt).toISOString(),
      },
      stats,
    },
  });
});
