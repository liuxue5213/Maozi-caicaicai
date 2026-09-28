import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db, onlineUsers, inGameUsers } from '../db/database';
import { authMiddleware } from '../middleware/auth';
import { AVATAR_PRESETS, FriendInfo, buildAchievementProgress } from '@maozi/shared';

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

// 更新头像（仅允许预设 emoji 头像）
userRouter.put('/avatar', (req: any, res: Response) => {
  const { avatar } = req.body;
  if (!avatar || !AVATAR_PRESETS.includes(avatar)) {
    res.status(400).json({ success: false, error: '无效的头像' });
    return;
  }

  db.updateUserAvatar(req.userId!, avatar);
  res.json({ success: true, data: { avatar } });
});

// ---- 好友 ----

// 好友列表（带在线/对局中状态）
userRouter.get('/friends', (req: any, res: Response) => {
  const friends: FriendInfo[] = db.getFriends(req.userId!).map(({ user, rank }) => ({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar,
    rank,
    online: onlineUsers.has(user.id),
    inGame: inGameUsers.has(user.id),
  }));
  res.json({ success: true, data: friends });
});

// 按用户名添加好友
userRouter.post('/friends', (req: any, res: Response) => {
  const username = String(req.body?.username || '').trim();
  if (!username) {
    res.status(400).json({ success: false, error: '请输入对方用户名' });
    return;
  }
  const target = db.findUserByUsername(username);
  if (!target) {
    res.status(404).json({ success: false, error: '用户不存在，确认一下用户名' });
    return;
  }
  if (target.id === req.userId) {
    res.status(400).json({ success: false, error: '不能添加自己为好友' });
    return;
  }
  if (!db.addFriend(req.userId!, target.id)) {
    res.status(400).json({ success: false, error: '对方已经在你的好友列表里了' });
    return;
  }
  res.json({
    success: true,
    data: { id: target.id, username: target.username, nickname: target.nickname, avatar: target.avatar, rank: db.getStats(target.id)?.rank ?? 1000, online: onlineUsers.has(target.id) } as FriendInfo,
  });
});

// 删除好友
userRouter.delete('/friends/:friendId', (req: any, res: Response) => {
  const removed = db.removeFriend(req.userId!, req.params.friendId);
  if (!removed) {
    res.status(404).json({ success: false, error: '好友不存在' });
    return;
  }
  res.json({ success: true, data: {} });
});

// 成就列表（按当前数据计算解锁状态与进度）
userRouter.get('/achievements', (req: any, res: Response) => {
  const stats = db.getStats(req.userId!);
  const progress = buildAchievementProgress({
    totalGames: stats?.totalGames ?? 0,
    wins: stats?.wins ?? 0,
    bestWinStreak: stats?.bestWinStreak ?? 0,
    rank: stats?.rank ?? 1000,
    aiWins: db.countAiWins(req.userId!),
    friends: db.getFriendsCount(req.userId!),
  });
  res.json({ success: true, data: progress });
});

// ---- 账号安全 ----

// 修改密码
userRouter.put('/password', async (req: any, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string' || !oldPassword || !newPassword) {
    res.status(400).json({ success: false, error: '请填写当前密码和新密码' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ success: false, error: '新密码长度至少 6 位' });
    return;
  }
  const user = db.findUserById(req.userId!);
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' });
    return;
  }
  const match = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!match) {
    res.status(400).json({ success: false, error: '当前密码不正确' });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.updateUserPassword(req.userId!, passwordHash);
  res.json({ success: true, data: {} });
});

// 注销账号（需密码确认；删除本人全部数据并清除在线状态）
userRouter.delete('/account', async (req: any, res: Response) => {
  const { password } = req.body;
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ success: false, error: '请输入密码确认注销' });
    return;
  }
  const user = db.findUserById(req.userId!);
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' });
    return;
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    res.status(400).json({ success: false, error: '密码不正确' });
    return;
  }
  db.deleteAccount(req.userId!);
  onlineUsers.delete(req.userId!);
  inGameUsers.delete(req.userId!);
  res.json({ success: true, data: {} });
});

// 获取游戏记录（按玩家视角返回：对手昵称、双方比分、胜负）
userRouter.get('/history', (req: any, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const records = db.getUserGameRecords(req.userId!, limit);

  const data = records.map((r) => {
    const isPlayer1 = r.player1Id === req.userId;
    const opponentId = isPlayer1 ? r.player2Id : r.player1Id;
    const isDraw = r.scorePlayer1 === r.scorePlayer2;
    const player1Won = Boolean(r.player1Won);
    const won = isDraw ? false : isPlayer1 ? player1Won : !player1Won;
    const opponent = opponentId ? db.findUserById(opponentId) : null;

    // 回放轮次转为对局者视角
    const invert = (result: string) => (result === 'WIN' ? 'LOSE' : result === 'LOSE' ? 'WIN' : 'DRAW');
    const rounds = r.rounds.map((rd) => ({
      player: isPlayer1 ? rd.p1 : rd.p2,
      opponent: isPlayer1 ? rd.p2 : rd.p1,
      result: isPlayer1 ? rd.r : invert(rd.r),
    }));

    return {
      id: r.id,
      timestamp: r.timestamp,
      mode: r.mode,
      isAi: !opponentId,
      opponentNickname: opponent ? opponent.nickname : 'AI 对手',
      myScore: isPlayer1 ? r.scorePlayer1 : r.scorePlayer2,
      opponentScore: isPlayer1 ? r.scorePlayer2 : r.scorePlayer1,
      isDraw,
      won,
      roundsCount: r.roundsCount,
      durationMs: r.durationMs,
      rounds,
    };
  });

  res.json({ success: true, data });
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
