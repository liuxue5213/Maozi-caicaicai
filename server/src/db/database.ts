import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface DbUser { id: string; username: string; passwordHash: string; nickname: string; avatar: string | null; createdAt: number; }
export interface DbStats { userId: string; totalGames: number; wins: number; losses: number; draws: number; currentWinStreak: number; bestWinStreak: number; rank: number; }
export interface DbGameRecord { id: string; timestamp: number; mode: number; player1Id: string; player2Id: string | null; player1Won: boolean; scorePlayer1: number; scorePlayer2: number; roundsCount: number; durationMs: number; }

let database: Database.Database | null = null;
const getDatabase = (): Database.Database => {
  if (!database) throw new Error('数据库尚未初始化');
  return database;
};

function toUser(row: Record<string, unknown> | undefined): DbUser | null {
  if (!row) return null;
  return { id: row.id as string, username: row.username as string, passwordHash: row.password_hash as string, nickname: row.nickname as string, avatar: row.avatar as string | null, createdAt: row.created_at as number };
}

function toStats(row: Record<string, unknown> | undefined): DbStats | null {
  if (!row) return null;
  return { userId: row.user_id as string, totalGames: row.total_games as number, wins: row.wins as number, losses: row.losses as number, draws: row.draws as number, currentWinStreak: row.current_win_streak as number, bestWinStreak: row.best_win_streak as number, rank: row.rank as number };
}

function toGameRecord(row: Record<string, unknown>): DbGameRecord {
  return { id: row.id as string, timestamp: row.timestamp as number, mode: row.mode as number, player1Id: row.player1_id as string, player2Id: row.player2_id as string | null, player1Won: Boolean(row.player1_won), scorePlayer1: row.score_player1 as number, scorePlayer2: row.score_player2 as number, roundsCount: row.rounds_count as number, durationMs: row.duration_ms as number };
}

export const db = {
  createUser(user: DbUser): DbUser {
    getDatabase().prepare('INSERT INTO users (id, username, password_hash, nickname, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.username.trim(), user.passwordHash, user.nickname.trim(), user.avatar, user.createdAt);
    return user;
  },
  findUserById(id: string): DbUser | null {
    return toUser(getDatabase().prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined);
  },
  findUserByUsername(username: string): DbUser | null {
    return toUser(getDatabase().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as Record<string, unknown> | undefined);
  },
  updateUserNickname(userId: string, nickname: string): void {
    getDatabase().prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname.trim(), userId);
  },
  updateUserAvatar(userId: string, avatar: string | null): void {
    getDatabase().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, userId);
  },
  getStats(userId: string): DbStats | null {
    return toStats(getDatabase().prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined);
  },
  createStats(userId: string): DbStats {
    getDatabase().prepare('INSERT OR IGNORE INTO user_stats (user_id, total_games, wins, losses, draws, current_win_streak, best_win_streak, rank) VALUES (?, 0, 0, 0, 0, 0, 0, 1000)').run(userId);
    return this.getStats(userId)!;
  },
  /**
   * 对局后更新战绩与段位分。
   * won === null 表示平局。opponentRank 为对手的段位分（人机对战视为 1000），
   * 按标准 ELO 期望分计算增减：赢强敌多加分，赢弱敌少加分，输给弱敌多扣分。
   */
  updateStatsAfterGame(userId: string, won: boolean | null, opponentRank = 1000): DbStats {
    const current = this.getStats(userId) || this.createStats(userId);
    const next: DbStats = { ...current, totalGames: current.totalGames + 1 };
    // ELO 期望胜率（K=32），myRank 取更新前的分数
    const expected = 1 / (1 + Math.pow(10, (opponentRank - current.rank) / 400));
    if (won === null) {
      next.draws++;
      // 平局按期望差微调：爆冷逼平强敌加分，被弱敌逼平扣分，限定在 -2 ~ +3
      next.rank += Math.max(-2, Math.min(3, Math.round(32 * (0.5 - expected))));
    } else if (won) {
      next.wins++;
      next.currentWinStreak++;
      next.bestWinStreak = Math.max(next.bestWinStreak, next.currentWinStreak);
      next.rank += Math.max(8, Math.round(32 * (1 - expected)));
    } else {
      next.losses++;
      next.currentWinStreak = 0;
      next.rank = Math.max(100, next.rank - Math.max(6, Math.round(32 * expected * 0.75)));
    }
    getDatabase().prepare('UPDATE user_stats SET total_games = ?, wins = ?, losses = ?, draws = ?, current_win_streak = ?, best_win_streak = ?, rank = ? WHERE user_id = ?').run(next.totalGames, next.wins, next.losses, next.draws, next.currentWinStreak, next.bestWinStreak, next.rank, userId);
    return next;
  },

  /**
   * 查询玩家在指定榜单中的名次（1 起始）与有战绩的玩家总数。
   * 打法与各 getLeaderboardBy* 的排序保持一致。
   */
  getMyRank(userId: string, type: 'wins' | 'streak' | 'rank'): { position: number; totalPlayers: number } {
    const mine = this.getStats(userId);
    if (!mine || mine.totalGames <= 0) return { position: 0, totalPlayers: this.countRankedPlayers() };

    const countAhead = (sql: string, ...params: (string | number)[]): number =>
      (getDatabase().prepare(sql).get(...params) as { count: number }).count;

    let position: number;
    if (type === 'wins') {
      position =
        1 +
        countAhead(
          'SELECT COUNT(*) AS count FROM user_stats WHERE total_games > 0 AND (wins > ? OR (wins = ? AND rank > ?))',
          mine.wins, mine.wins, mine.rank
        );
    } else if (type === 'streak') {
      position =
        1 +
        countAhead(
          'SELECT COUNT(*) AS count FROM user_stats WHERE total_games > 0 AND (best_win_streak > ? OR (best_win_streak = ? AND rank > ?))',
          mine.bestWinStreak, mine.bestWinStreak, mine.rank
        );
    } else {
      position =
        1 +
        countAhead(
          'SELECT COUNT(*) AS count FROM user_stats WHERE total_games > 0 AND (rank > ? OR (rank = ? AND wins > ?))',
          mine.rank, mine.rank, mine.wins
        );
    }
    return { position, totalPlayers: this.countRankedPlayers() };
  },

  countRankedPlayers(): number {
    return (getDatabase().prepare('SELECT COUNT(*) AS count FROM user_stats WHERE total_games > 0').get() as { count: number }).count;
  },
  getLeaderboardByWins(limit = 100): Array<{ user: DbUser; stats: DbStats }> {
    const rows = getDatabase().prepare('SELECT u.*, s.* FROM user_stats s JOIN users u ON u.id = s.user_id WHERE s.total_games > 0 ORDER BY s.wins DESC, s.rank DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({ user: toUser(row)!, stats: toStats(row)! }));
  },
  getLeaderboardByWinStreak(limit = 100): Array<{ user: DbUser; stats: DbStats }> {
    const rows = getDatabase().prepare('SELECT u.*, s.* FROM user_stats s JOIN users u ON u.id = s.user_id WHERE s.total_games > 0 ORDER BY s.best_win_streak DESC, s.rank DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({ user: toUser(row)!, stats: toStats(row)! }));
  },
  getLeaderboardByRank(limit = 100): Array<{ user: DbUser; stats: DbStats }> {
    const rows = getDatabase().prepare('SELECT u.*, s.* FROM user_stats s JOIN users u ON u.id = s.user_id WHERE s.total_games > 0 ORDER BY s.rank DESC, s.wins DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({ user: toUser(row)!, stats: toStats(row)! }));
  },
  addGameRecord(record: DbGameRecord): void {
    getDatabase().prepare('INSERT INTO game_records (id, timestamp, mode, player1_id, player2_id, player1_won, score_player1, score_player2, rounds_count, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.timestamp, record.mode, record.player1Id, record.player2Id, Number(record.player1Won), record.scorePlayer1, record.scorePlayer2, record.roundsCount, record.durationMs);
  },
  getUserGameRecords(userId: string, limit = 50): DbGameRecord[] {
    const validLimit = Math.min(Math.max(limit, 1), 100);
    return (getDatabase().prepare('SELECT * FROM game_records WHERE player1_id = ? OR player2_id = ? ORDER BY timestamp DESC LIMIT ?').all(userId, userId, validLimit) as Record<string, unknown>[]).map(toGameRecord);
  },
  getUserCount(): number { return (getDatabase().prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count; },
  getOnlineUserCount(): number { return onlineUsers.size; },
};

export const onlineUsers: Set<string> = new Set();

export async function initDatabase(): Promise<void> {
  if (database) return;
  const databasePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'maozi-rps.db');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, nickname TEXT NOT NULL, avatar TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_stats (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, total_games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, current_win_streak INTEGER NOT NULL DEFAULT 0, best_win_streak INTEGER NOT NULL DEFAULT 0, rank INTEGER NOT NULL DEFAULT 1000);
    CREATE TABLE IF NOT EXISTS game_records (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, mode INTEGER NOT NULL, player1_id TEXT NOT NULL REFERENCES users(id), player2_id TEXT REFERENCES users(id), player1_won INTEGER NOT NULL, score_player1 INTEGER NOT NULL, score_player2 INTEGER NOT NULL, rounds_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_game_records_player1 ON game_records(player1_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_game_records_player2 ON game_records(player2_id, timestamp DESC);
  `);
  console.log(`[Database] SQLite 已就绪: ${databasePath}`);
}
