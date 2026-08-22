import { Router, Request, Response } from 'express';
import { db } from '../db/database';

export const leaderboardRouter = Router();

// 无需登录即可查看排行榜
leaderboardRouter.get('/', (req: Request, res: Response) => {
  const type = req.query.type as string || 'wins';
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

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

// 获取在线人数
leaderboardRouter.get('/online-count', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { count: db.getOnlineUserCount() },
  });
});
