import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { authMiddleware } from '../middleware/auth';
import { MyRankInfo } from '@maozi/shared';

export const leaderboardRouter = Router();

const parseType = (value: unknown): 'wins' | 'streak' | 'rank' =>
  value === 'streak' || value === 'rank' ? value : 'wins';

// 无需登录即可查看排行榜
leaderboardRouter.get('/', (req: Request, res: Response) => {
  const type = req.query.type as string || 'wins';
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

  const leaderboard =
    type === 'streak'
      ? db.getLeaderboardByWinStreak(limit)
      : type === 'rank'
        ? db.getLeaderboardByRank(limit)
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

// 当前登录玩家在指定榜单中的名次（可能不在榜单前列，供客户端底部固定展示）
leaderboardRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  const type = parseType(req.query.type);
  const stats = db.getStats(req.userId!);
  if (!stats || stats.totalGames <= 0) {
    const info: MyRankInfo = { type, position: 0, totalPlayers: db.countRankedPlayers(), stats: stats ?? {
      userId: req.userId!,
      totalGames: 0, wins: 0, losses: 0, draws: 0,
      currentWinStreak: 0, bestWinStreak: 0, rank: 1000,
    } };
    res.json({ success: true, data: info });
    return;
  }

  const { position, totalPlayers } = db.getMyRank(req.userId!, type);
  const info: MyRankInfo = { type, position, totalPlayers, stats };
  res.json({ success: true, data: info });
});
