import { Router, Response } from 'express';
import { db } from '../db/database';
import { authMiddleware } from '../middleware/auth';

export const userRouter = Router();

userRouter.use(authMiddleware);

// 获取当前用户信息
userRouter.get('/me', (req: any, res: Response) => {
  const user = db.findUserById(req.userId!);
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

// 更新昵称
userRouter.put('/nickname', (req: any, res: Response) => {
  const { nickname } = req.body;
  if (!nickname || nickname.length < 1 || nickname.length > 20) {
    res.status(400).json({ success: false, error: '昵称长度应为 1-20 个字符' });
    return;
  }

  db.updateUserNickname(req.userId!, nickname);
  res.json({ success: true, data: { nickname } });
});

// 获取游戏记录
userRouter.get('/history', (req: any, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const records = db.getUserGameRecords(req.userId!, limit);
  res.json({ success: true, data: records });
});

// 获取排行榜
userRouter.get('/leaderboard', (_req: any, res: Response) => {
  const type = _req.query.type as string || 'wins';
  const limit = parseInt(_req.query.limit as string) || 100;

  const leaderboard = type === 'streak'
    ? db.getLeaderboardByWinStreak(limit)
    : db.getLeaderboardByWins(limit);

  res.json({
    success: true,
    data: leaderboard.map((entry, index) => ({
      rank: index + 1,
      user: {
        id: entry.user.id,
        username: entry.user.username,
        nickname: entry.user.nickname,
        avatar: entry.user.avatar,
      },
      stats: entry.stats,
    })),
  });
});
