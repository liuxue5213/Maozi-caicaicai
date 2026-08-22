export declare enum GameChoice {
    ROCK = "ROCK",
    SCISSORS = "SCISSORS",
    PAPER = "PAPER"
}
export declare enum RoundResult {
    WIN = "WIN",
    LOSE = "LOSE",
    DRAW = "DRAW"
}
export declare enum GameMode {
    BEST_OF_3 = 3,
    BEST_OF_5 = 5,
    BEST_OF_7 = 7,
    BEST_OF_10 = 10
}
export declare const GAME_MODE_LABELS: Record<GameMode, string>;
export declare enum GamePhase {
    WAITING = "WAITING",// 等待对手
    PREPARATION = "PREPARATION",// 准备阶段（5秒）
    SELECTING = "SELECTING",// 选择阶段（10秒）
    SETTLEMENT = "SETTLEMENT",// 结算阶段（3秒）
    BREAK = "BREAK",// 间歇阶段（2秒）
    FINISHED = "FINISHED"
}
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
    rank: number;
}
export interface LeaderboardEntry {
    rank: number;
    user: User;
    stats: UserStats;
    title: TitleInfo;
}
export interface TitleInfo {
    name: string;
    description: string;
    color: string;
    glow?: boolean;
}
export declare enum ClientMessage {
    AUTH = "AUTH",
    START_MATCHING = "START_MATCHING",
    CANCEL_MATCHING = "CANCEL_MATCHING",
    MAKE_CHOICE = "MAKE_CHOICE",
    START_AI_MATCH = "START_AI_MATCH",
    PING = "PING",
    RECONNECT = "RECONNECT"
}
export declare enum ServerMessage {
    AUTH_RESULT = "AUTH_RESULT",
    MATCHING = "MATCHING",
    MATCH_FOUND = "MATCH_FOUND",
    MATCH_TIMEOUT = "MATCH_TIMEOUT",
    GAME_START = "GAME_START",
    PHASE_UPDATE = "PHASE_UPDATE",
    ROUND_RESULT = "ROUND_RESULT",
    GAME_OVER = "GAME_OVER",
    OPPONENT_DISCONNECTED = "OPPONENT_DISCONNECTED",
    OPPONENT_RECONNECTED = "OPPONENT_RECONNECTED",
    PONG = "PONG",
    ERROR = "ERROR"
}
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
    } | null;
    isAi: boolean;
}
export interface PhaseUpdatePayload {
    phase: GamePhase;
    roundNumber: number;
    timeRemaining: number;
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
    finalScore: {
        player: number;
        opponent: number;
    };
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
    result: RoundResult | null;
}
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
export declare const GAME_TIMINGS: {
    readonly PREPARATION_MS: 5000;
    readonly SELECTING_MS: 10000;
    readonly SETTLEMENT_MS: 3000;
    readonly BREAK_MS: 2000;
    readonly MATCH_TIMEOUT_MS: 30000;
    readonly RECONNECT_TIMEOUT_MS: 60000;
    readonly PING_INTERVAL_MS: 15000;
};
export declare const AI_NICKNAMES: string[];
//# sourceMappingURL=index.d.ts.map