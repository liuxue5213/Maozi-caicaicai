// ============================================
// 帽子猜猜猜 - 共享类型和常量定义
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

// ---- AI 难度 ----

export type AiDifficulty = 'easy' | 'normal' | 'hard';

export const AI_DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

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
  // 重连恢复成功（服务器 -> 断线重连的玩家）
  RECONNECT_SUCCESS = 'RECONNECT_SUCCESS',
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
  aiDifficulty?: AiDifficulty;
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

export interface ReconnectSuccessPayload {
  gameId: string;
  mode: GameMode;
  isAi: boolean;
  opponent: { id: string; nickname: string; avatar?: string } | null;
  roundNumber: number;
  playerScore: number;
  opponentScore: number;
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

// ---- 称号系统（前后端共享） ----

const GAME_COUNT_TITLES: TitleInfo[] = [
  { name: '猜拳萌新', description: '初入拳坛的新手', color: '#9E9E9E' },
  { name: '初学者', description: '正在摸索门道', color: '#9E9E9E' },
  { name: '练习生', description: '每日苦练不辍', color: '#9E9E9E' },
  { name: '入门学徒', description: '掌握基本规则', color: '#666666' },
  { name: '拳坛新秀', description: '初露锋芒', color: '#666666' },
  { name: '出拳者', description: '敢于亮剑', color: '#666666' },
  { name: '石头学徒', description: '偏爱石头的坚定', color: '#666666' },
  { name: '剪刀行者', description: '剪刀出手如风', color: '#4CAF50' },
  { name: '布艺大师', description: '以柔克刚之道', color: '#4CAF50' },
  { name: '三修学徒', description: '三系兼修均衡发展', color: '#4CAF50' },
  { name: '对局常客', description: '拳场老面孔', color: '#4CAF50' },
  { name: '资深拳手', description: '身经百战', color: '#4CAF50' },
  { name: '拳坛老手', description: '经验丰富的高手', color: '#2196F3' },
  { name: '百胜将军', description: '已获百胜战绩', color: '#2196F3' },
  { name: '常胜将军', description: '胜多负少', color: '#2196F3' },
  { name: '猜拳达人', description: '人人皆知的高手', color: '#2196F3' },
  { name: '拳场明星', description: '聚光灯下的焦点', color: '#2196F3' },
  { name: '实力拳师', description: '实力得到认可', color: '#9C27B0' },
  { name: '不败传说', description: '极少尝败绩', color: '#9C27B0', glow: true },
  { name: '猜拳大师', description: '一代宗师风范', color: '#9C27B0', glow: true },
  { name: '传奇拳手', description: '拳坛传奇人物', color: '#9C27B0', glow: true },
  { name: '千场战神', description: '历经千场磨砺', color: '#9C27B0', glow: true },
  { name: '超凡入圣', description: '超越凡俗的境界', color: '#FFD700', glow: true },
  { name: '登峰造极', description: '技艺已达顶峰', color: '#FFD700', glow: true },
  { name: '拳霸天下', description: '天下无敌手', color: '#FFD700', glow: true },
  { name: '猜拳之王', description: '称霸拳坛的王者', color: '#FFD700', glow: true },
  { name: '猜拳宗师', description: '猜拳领域的至尊', color: '#FFD700', glow: true },
];

const WIN_STREAK_TITLES: [number, TitleInfo][] = [
  [3, { name: '三连胜挑战者', description: '初尝连胜滋味', color: '#9E9E9E' }],
  [5, { name: '连胜先锋', description: '连胜的气势', color: '#4CAF50' }],
  [8, { name: '势如破竹', description: '无人可挡', color: '#2196F3' }],
  [10, { name: '不败战神', description: '十连胜的荣耀', color: '#9C27B0', glow: true }],
  [15, { name: '拳坛霸主', description: '称霸一方的存在', color: '#9C27B0', glow: true }],
  [20, { name: '猜拳之神', description: '二十连胜神话', color: '#FFD700', glow: true }],
  [30, { name: '无敌传说', description: '天下无敌', color: '#FFD700', glow: true }],
  [50, { name: '传奇王者', description: '五十连胜传说', color: '#FF6F00', glow: true }],
  [100, { name: '绝世拳圣', description: '百连胜震古烁今', color: '#FF6F00', glow: true }],
];

export function getGameCountTitle(games: number): TitleInfo {
  if (games <= 0) return GAME_COUNT_TITLES[0];
  const index = Math.min(Math.floor((games - 1) / 200), GAME_COUNT_TITLES.length - 1);
  return GAME_COUNT_TITLES[index];
}

export function getWinStreakTitle(streak: number): TitleInfo | null {
  for (let i = WIN_STREAK_TITLES.length - 1; i >= 0; i--) {
    if (streak >= WIN_STREAK_TITLES[i][0]) {
      return WIN_STREAK_TITLES[i][1];
    }
  }
  return null;
}
