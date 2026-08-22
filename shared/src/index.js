"use strict";
// ============================================
// 猜拳对战 - 共享类型和常量定义
// 前后端共享此文件，保证类型一致
// ============================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_NICKNAMES = exports.GAME_TIMINGS = exports.ServerMessage = exports.ClientMessage = exports.GamePhase = exports.GAME_MODE_LABELS = exports.GameMode = exports.RoundResult = exports.GameChoice = void 0;
// ---- 游戏核心类型 ----
var GameChoice;
(function (GameChoice) {
    GameChoice["ROCK"] = "ROCK";
    GameChoice["SCISSORS"] = "SCISSORS";
    GameChoice["PAPER"] = "PAPER";
})(GameChoice || (exports.GameChoice = GameChoice = {}));
var RoundResult;
(function (RoundResult) {
    RoundResult["WIN"] = "WIN";
    RoundResult["LOSE"] = "LOSE";
    RoundResult["DRAW"] = "DRAW";
})(RoundResult || (exports.RoundResult = RoundResult = {}));
var GameMode;
(function (GameMode) {
    GameMode[GameMode["BEST_OF_3"] = 3] = "BEST_OF_3";
    GameMode[GameMode["BEST_OF_5"] = 5] = "BEST_OF_5";
    GameMode[GameMode["BEST_OF_7"] = 7] = "BEST_OF_7";
    GameMode[GameMode["BEST_OF_10"] = 10] = "BEST_OF_10";
})(GameMode || (exports.GameMode = GameMode = {}));
exports.GAME_MODE_LABELS = {
    [GameMode.BEST_OF_3]: '三局两胜',
    [GameMode.BEST_OF_5]: '五局三胜',
    [GameMode.BEST_OF_7]: '七局四胜',
    [GameMode.BEST_OF_10]: '十局六胜',
};
// ---- 游戏阶段 ----
var GamePhase;
(function (GamePhase) {
    GamePhase["WAITING"] = "WAITING";
    GamePhase["PREPARATION"] = "PREPARATION";
    GamePhase["SELECTING"] = "SELECTING";
    GamePhase["SETTLEMENT"] = "SETTLEMENT";
    GamePhase["BREAK"] = "BREAK";
    GamePhase["FINISHED"] = "FINISHED";
})(GamePhase || (exports.GamePhase = GamePhase = {}));
// ---- WebSocket 通信协议 ----
// 客户端 -> 服务器
var ClientMessage;
(function (ClientMessage) {
    // 认证
    ClientMessage["AUTH"] = "AUTH";
    // 匹配
    ClientMessage["START_MATCHING"] = "START_MATCHING";
    ClientMessage["CANCEL_MATCHING"] = "CANCEL_MATCHING";
    // 游戏
    ClientMessage["MAKE_CHOICE"] = "MAKE_CHOICE";
    // 人机匹配
    ClientMessage["START_AI_MATCH"] = "START_AI_MATCH";
    // 心跳
    ClientMessage["PING"] = "PING";
    // 重连
    ClientMessage["RECONNECT"] = "RECONNECT";
})(ClientMessage || (exports.ClientMessage = ClientMessage = {}));
// 服务器 -> 客户端
var ServerMessage;
(function (ServerMessage) {
    // 认证结果
    ServerMessage["AUTH_RESULT"] = "AUTH_RESULT";
    // 匹配状态
    ServerMessage["MATCHING"] = "MATCHING";
    ServerMessage["MATCH_FOUND"] = "MATCH_FOUND";
    ServerMessage["MATCH_TIMEOUT"] = "MATCH_TIMEOUT";
    // 游戏状态
    ServerMessage["GAME_START"] = "GAME_START";
    ServerMessage["PHASE_UPDATE"] = "PHASE_UPDATE";
    ServerMessage["ROUND_RESULT"] = "ROUND_RESULT";
    ServerMessage["GAME_OVER"] = "GAME_OVER";
    // 对手状态
    ServerMessage["OPPONENT_DISCONNECTED"] = "OPPONENT_DISCONNECTED";
    ServerMessage["OPPONENT_RECONNECTED"] = "OPPONENT_RECONNECTED";
    // 心跳
    ServerMessage["PONG"] = "PONG";
    // 错误
    ServerMessage["ERROR"] = "ERROR";
})(ServerMessage || (exports.ServerMessage = ServerMessage = {}));
// ---- 常量 ----
exports.GAME_TIMINGS = {
    PREPARATION_MS: 5000,
    SELECTING_MS: 10000,
    SETTLEMENT_MS: 3000,
    BREAK_MS: 2000,
    MATCH_TIMEOUT_MS: 30000,
    RECONNECT_TIMEOUT_MS: 60000,
    PING_INTERVAL_MS: 15000,
};
exports.AI_NICKNAMES = [
    '拳王小明', '剪刀手阿艺', '石头大叔', '布艺少女', '随机达人',
    '闪电出拳', '慢半拍', '常胜将军', '猜拳萌新', '神秘人',
];
//# sourceMappingURL=index.js.map