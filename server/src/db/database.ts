/**
 * 简单内存数据库（MVP 版本）
 * 生产环境应替换为 PostgreSQL / MySQL / SQLite
 */

export interface DbUser {
  id: string;
  username: string;
  passwordHash: string;
  nickname: string;
  avatar: string | null;
  createdAt: number;
}

export interface DbStats {
  userId: string;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  bestWinStreak: number;
  rank: number;
}

export interface DbGameRecord {
  id: string;
  timestamp: number;
  mode: number;
  player1Id: string;
  player2Id: string | null; // null 表示 AI
  player1Won: boolean;
  scorePlayer1: number;
  scorePlayer2: number;
  roundsCount: number;
  durationMs: number;
}

// 内存存储
const users: Map<string, DbUser> = new Map();
const usersByUsername: Map<string, string> = new Map(); // username -> userId
const stats: Map<string, DbStats> = new Map();
const gameRecords: DbGameRecord[] = [];

export const db = {
  // ---- 用户操作 ----
  
  createUser(user: DbUser): DbUser {
    users.set(user.id, user);
    usersByUsername.set(user.username.toLowerCase(), user.id);
    return user;
  },

  findUserById(id: string): DbUser | null {
    return users.get(id) || null;
  },

  findUserByUsername(username: string): DbUser | null {
    const userId = usersByUsername.get(username.toLowerCase());
    return userId ? (users.get(userId) || null) : null;
  },

  updateUserNickname(userId: string, nickname: string): void {
    const user = users.get(userId);
    if (user) user.nickname = nickname;
  },

  updateUserAvatar(userId: string, avatar: string | null): void {
    const user = users.get(userId);
    if (user) user.avatar = avatar;
  },

  // ---- 统计数据 ----

  getStats(userId: string): DbStats | null {
    return stats.get(userId) || null;
  },

  createStats(userId: string): DbStats {
    const newStats: DbStats = {
      userId,
      totalGames: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      currentWinStreak: 0,
      bestWinStreak: 0,
      rank: 1000, // 初始段位分
    };
    stats.set(userId, newStats);
    return newStats;
  },

  updateStatsAfterGame(
    userId: string,
    won: boolean | null  // null = 平局, true = 胜, false = 负
  ): DbStats {
    const userStats = stats.get(userId) || this.createStats(userId);
    
    userStats.totalGames++;
    
    if (won === null) {
      // 平局：连胜不重置也不增加，计入场次
      userStats.draws++;
      userStats.rank += 3; // 平局少量加分
    } else if (won) {
      userStats.wins++;
      userStats.currentWinStreak++;
      if (userStats.currentWinStreak > userStats.bestWinStreak) {
        userStats.bestWinStreak = userStats.currentWinStreak;
      }
      userStats.rank += 15 + Math.min(userStats.currentWinStreak * 2, 20);
    } else {
      userStats.losses++;
      userStats.currentWinStreak = 0;
      userStats.rank = Math.max(100, userStats.rank - 10);
    }
    
    stats.set(userId, userStats);
    return userStats;
  },

  // ---- 排行榜 ----

  getLeaderboardByWins(limit: number = 100): Array<{ user: DbUser; stats: DbStats }> {
    const allStats = Array.from(stats.entries())
      .map(([userId, s]) => ({ userId, stats: s }))
      .filter(item => item.stats.totalGames > 0)
      .sort((a, b) => b.stats.wins - a.stats.wins || b.stats.rank - a.stats.rank)
      .slice(0, limit);

    return allStats.map(({ userId, stats: s }) => ({
      user: users.get(userId)!,
      stats: s,
    })).filter(item => item.user);
  },

  getLeaderboardByWinStreak(limit: number = 100): Array<{ user: DbUser; stats: DbStats }> {
    const allStats = Array.from(stats.entries())
      .map(([userId, s]) => ({ userId, stats: s }))
      .filter(item => item.stats.bestWinStreak > 0)
      .sort((a, b) => b.stats.bestWinStreak - a.stats.bestWinStreak)
      .slice(0, limit);

    return allStats.map(({ userId, stats: s }) => ({
      user: users.get(userId)!,
      stats: s,
    })).filter(item => item.user);
  },

  // ---- 游戏记录 ----

  addGameRecord(record: DbGameRecord): void {
    gameRecords.unshift(record);
    // 保留最近 10000 条
    if (gameRecords.length > 10000) {
      gameRecords.length = 10000;
    }
  },

  getUserGameRecords(userId: string, limit: number = 50): DbGameRecord[] {
    return gameRecords
      .filter(r => r.player1Id === userId || r.player2Id === userId)
      .slice(0, limit);
  },

  // ---- 管理 ----

  getUserCount(): number {
    return users.size;
  },

  getOnlineUserCount(): number {
    // 由 WebSocket 服务维护
    return onlineUsers.size;
  },
};

// 在线用户（由 WebSocket 服务维护）
export const onlineUsers: Set<string> = new Set();

export async function initDatabase(): Promise<void> {
  console.log('[Database] 使用内存数据库（MVP 模式）');
  console.log('[Database] 注意：重启后数据会丢失，生产环境请替换为持久化存储');
}
