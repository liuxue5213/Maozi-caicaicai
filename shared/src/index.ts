// ============================================
// 猜拳对战 - 共享类型和常量定义
// 前后端共享此文件，保证类型一致
// ============================================

// ---- 游戏核心类型 ----

export enum GameChoice {
  ROCK = 'ROCK',
  SCISSORS = 'SCISSORS',
  PAPER = 'PAPER',
}

export enum RoundResult {
  WIN = 'WIN',
  LOSE = 'LOSE',
  DRAW = 'DRAW',
}

export enum GameMode {
  BEST_OF_3 = 3,
  BEST_OF_5 = 5,
  BEST_OF_7 = 7,
  BEST_OF_10 = 10,
}

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  [GameMode.BEST_OF_3]: '三局两胜',
  [GameMode.BEST_OF_5]: '五局三胜',
  [GameMode.BEST_OF_7]: '七局四胜',
  [GameMode.BEST_OF_10]: '十局六胜',
};

// ---- 游戏阶段 ----

export enum GamePhase {
  WAITING = 'WAITING',         // 等待对手
  PREPARATION = 'PREPARATION', // 准备阶段（5秒）
  SELECTING = 'SELECTING',     // 选择阶段（10秒）
  SETTLEMENT = 'SETTLEMENT',   // 结算阶段（3秒）
  BREAK = 'BREAK',             // 间歇阶段（2秒）
  FINISHED = 'FINISHED',       // 对局结束
}

// ---- 用户相关 ----

export interface User {
  id: string;
  username: string;
  nickname: string;
  avatar?: string;
  createdAt: string;
}

export interface UserStats {
  userId: string;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  bestWinStreak: number;
  rank: number; // ELO 段位分
}

export interface LeaderboardEntry {
  rank: number;
  user: User;
  stats: UserStats;
  title: TitleInfo;
}

// ---- 称号系统 ----

export interface TitleInfo {
  name: string;
  description: string;
  color: string;
  glow?: boolean;
}

// ---- WebSocket 通信协议 ----

// 客户端 -> 服务器
export enum ClientMessage {
  // 认证
  AUTH = 'AUTH',
  // 匹配
  START_MATCHING = 'START_MATCHING',
  CANCEL_MATCHING = 'CANCEL_MATCHING',
  // 游戏
  MAKE_CHOICE = 'MAKE_CHOICE',
  // 人机匹配
  START_AI_MATCH = 'START_AI_MATCH',
  // 心跳
  PING = 'PING',
  // 重连
  RECONNECT = 'RECONNECT',
}

// 服务器 -> 客户端
export enum ServerMessage {
  // 认证结果
  AUTH_RESULT = 'AUTH_RESULT',
  // 匹配状态
  MATCHING = 'MATCHING',
  MATCH_FOUND = 'MATCH_FOUND',
  MATCH_TIMEOUT = 'MATCH_TIMEOUT',
  // 游戏状态
  GAME_START = 'GAME_START',
  PHASE_UPDATE = 'PHASE_UPDATE',
  ROUND_RESULT = 'ROUND_RESULT',
  GAME_OVER = 'GAME_OVER',
  // 对手状态
  OPPONENT_DISCONNECTED = 'OPPONENT_DISCONNECTED',
  OPPONENT_RECONNECTED = 'OPPONENT_RECONNECTED',
  // 心跳
  PONG = 'PONG',
  // 错误
  ERROR = 'ERROR',
}

// ---- WebSocket 消息载荷 ----

export interface AuthPayload {
  token: string;
}

export interface StartMatchingPayload {
  mode: GameMode;
}

export interface StartAiMatchPayload {
  mode: GameMode;
  aiDifficulty?: 'easy' | 'normal' | 'hard';
}

export interface MakeChoicePayload {
  choice: GameChoice;
}

export interface GameStartPayload {
  gameId: string;
  mode: GameMode;
  opponent: {
    id: string;
    nickname: string;
    avatar?: string;
  } | null; // null 表示 AI
  isAi: boolean;
}

export interface PhaseUpdatePayload {
  phase: GamePhase;
  roundNumber: number;
  timeRemaining: number; // 毫秒
  playerScore: number;
  opponentScore: number;
}

export interface RoundResultPayload {
  roundNumber: number;
  playerChoice: GameChoice;
  opponentChoice: GameChoice;
  result: RoundResult;
  playerScore: number;
  opponentScore: number;
}

export interface GameOverPayload {
  gameId: string;
  playerWon: boolean;
  finalScore: { player: number; opponent: number };
  totalRounds: number;
  durationMs: number;
  stats: {
    totalGames: number;
    wins: number;
    losses: number;
    currentWinStreak: number;
    bestWinStreak: number;
    rank: number;
  };
  titles: {
    gameCountTitle: TitleInfo;
    winStreakTitle: TitleInfo | null;
  };
}

// ---- 游戏房间状态 ----

export interface GameRoom {
  id: string;
  mode: GameMode;
  phase: GamePhase;
  players: [GamePlayer, GamePlayer | null];
  isAi: boolean;
  currentRound: RoundData;
  roundHistory: RoundData[];
  startedAt: number;
}

export interface GamePlayer {
  id: string;
  nickname: string;
  choice: GameChoice | null;
  score: number;
  connected: boolean;
}

export interface RoundData {
  roundNumber: number;
  player1Choice: GameChoice | null;
  player2Choice: GameChoice | null;
  result: RoundResult | null; // 从 player1 视角
}

// ---- REST API 类型 ----

export interface RegisterRequest {
  username: string;
  password: string;
  nickname: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  stats: UserStats;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---- 常量 ----

export const GAME_TIMINGS = {
  PREPARATION_MS: 5000,
  SELECTING_MS: 10000,
  SETTLEMENT_MS: 3000,
  BREAK_MS: 2000,
  MATCH_TIMEOUT_MS: 30000,
  RECONNECT_TIMEOUT_MS: 60000,
  PING_INTERVAL_MS: 15000,
} as const;

export const AI_NICKNAMES = [
  '拳王小明', '剪刀手阿艺', '石头大叔', '布艺少女', '随机达人',
  '闪电出拳', '慢半拍', '常胜将军', '猜拳萌新', '神秘人',
];
