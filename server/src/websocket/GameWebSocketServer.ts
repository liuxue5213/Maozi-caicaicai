import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  ClientMessage,
  ServerMessage,
  GameChoice,
  GameMode,
  GamePhase,
  RoundResult,
  GAME_TIMINGS,
  AI_NICKNAMES,
  AiDifficulty,
  getGameCountTitle,
  getWinStreakTitle,
  PrivateRoomCreatedPayload,
} from '@maozi/shared';
import { db, onlineUsers, DbUser } from '../db/database';
import { verifyToken } from '../utils/jwt';

// ============================================
// 连接与游戏状态
// ============================================

/**
 * 测试/演示时可整体加速游戏节奏：GAME_TIME_SCALE=0.2 表示所有时长变为原来的 20%
 */
const TIME_SCALE = Math.min(Math.max(Number(process.env.GAME_TIME_SCALE) || 1, 0.05), 5);
const scaled = (ms: number) => Math.max(Math.round(ms * TIME_SCALE), 300);
const T = {
  PREPARATION_MS: () => scaled(GAME_TIMINGS.PREPARATION_MS),
  SELECTING_MS: () => scaled(GAME_TIMINGS.SELECTING_MS),
  SETTLEMENT_MS: () => scaled(GAME_TIMINGS.SETTLEMENT_MS),
  BREAK_MS: () => scaled(GAME_TIMINGS.BREAK_MS),
  MATCH_TIMEOUT_MS: () => scaled(GAME_TIMINGS.MATCH_TIMEOUT_MS),
  RECONNECT_TIMEOUT_MS: () => scaled(GAME_TIMINGS.RECONNECT_TIMEOUT_MS),
};

/** 全部可选手势（超时随机出拳等场景使用） */
const ALL_CHOICES: GameChoice[] = [GameChoice.ROCK, GameChoice.SCISSORS, GameChoice.PAPER];

/** AI 用于记忆玩家出拳倾向的状态（一局内累计） */
interface AiMemory {
  counts: Record<GameChoice, number>;
  lastPlayerChoice: GameChoice | null;
}

/** 返回能克制 choice 的手势 */
function beatOf(choice: GameChoice): GameChoice {
  switch (choice) {
    case GameChoice.ROCK: return GameChoice.PAPER;
    case GameChoice.SCISSORS: return GameChoice.ROCK;
    default: return GameChoice.SCISSORS;
  }
}

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  username: string;
  nickname: string;
  /** 段位分，用于按实力匹配（认证时载入） */
  rank: number;
  isAuthenticated: boolean;
  currentGameId: string | null;
  isMatching: boolean;
  matchingMode: GameMode | null;
  matchingSince: number | null;
  lastPing: number;
  /** 消息速率限制：1 秒滑动窗口内的消息数 */
  msgWindowStart: number;
  msgCount: number;
}

/** 私密房间（邀请码对战）：房主建房后把邀请码发给好友，好友凭码入房 */
interface PendingPrivateRoom {
  code: string;
  hostClientId: string;
  mode: GameMode;
  createdAt: number;
}

/** 邀请码字符集（去掉易混淆的 I/O/0/1） */
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
/** 私密房间创建后的有效期（无人加入则自动失效） */
const PRIVATE_ROOM_TTL_MS = 10 * 60 * 1000;
/** 单连接消息频率上限（每秒），超出后静默丢弃 */
const WS_MSG_RATE_LIMIT = 30;

interface GameRoom {
  id: string;
  mode: GameMode;
  phase: GamePhase;
  players: { user: DbUser; ws: WebSocket; choice: GameChoice | null; score: number; connected: boolean }[];
  isAi: boolean;
  aiDifficulty: AiDifficulty;
  aiMemory: AiMemory;
  roundNumber: number;
  startedAt: number;
  phaseTimer: NodeJS.Timeout | null;
  /** 连续平局轮数 */
  consecutiveDraws: number;
  /** 连续 3 轮平局后进入突然死亡：下一个非平局回合直接决定胜负 */
  suddenDeath: boolean;
  /** 突然死亡回合已分出胜负（由结算阶段标记） */
  suddenDeathDecided: boolean;
}

export class GameWebSocketServer {
  private clients: Map<string, ConnectedClient> = new Map();
  private games: Map<string, GameRoom> = new Map();
  /** userId -> 进行中对局，支持断线重连找回房间 */
  private userGames: Map<string, string> = new Map();
  private matchingQueue: ConnectedClient[] = [];
  /** 邀请码 -> 待开始的私密房间 */
  private privateRooms: Map<string, PendingPrivateRoom> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private wss: WebSocketServer) {
    this.start();
  }

  private start(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuidv4();
      const client: ConnectedClient = {
        ws,
        userId: '',
        username: '',
        nickname: '',
        rank: 1000,
        isAuthenticated: false,
        currentGameId: null,
        isMatching: false,
        matchingMode: null,
        matchingSince: null,
        lastPing: Date.now(),
        msgWindowStart: Date.now(),
        msgCount: 0,
      };
      this.clients.set(clientId, client);

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch (e) {
          console.error('[WebSocket] 消息解析失败:', e);
        }
      });

      // code 1000 表示客户端主动正常关闭（如玩家主动退出对局）
      ws.on('close', (code: number) => {
        this.handleDisconnect(clientId, code);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] 连接错误:', error);
      });

      // 发送连接成功消息
      this.sendToClient(ws, { type: ServerMessage.AUTH_RESULT, payload: { connected: true, clientId } });
    });

    // 心跳检测：连接层的超时阈值不随 GAME_TIME_SCALE 缩放，
    // 否则会误杀节奏加快的对局中正常的低频心跳连接
    const heartbeatTimeout = GAME_TIMINGS.RECONNECT_TIMEOUT_MS; // 60秒无响应则断开
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.clients.forEach((client, clientId) => {
        if (now - client.lastPing > heartbeatTimeout) {
          console.log(`[WebSocket] 心跳超时，断开连接: ${client.userId || clientId}`);
          client.ws.terminate();
          this.handleDisconnect(clientId);
        }
      });
      this.sweepExpiredPrivateRooms();
    }, GAME_TIMINGS.PING_INTERVAL_MS);

    console.log('[WebSocket] 游戏服务器已启动');
  }

  private handleMessage(clientId: string, message: { type: string; payload?: any }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // 消息速率限制：超出上限的消息静默丢弃，防止恶意刷消息
    const now = Date.now();
    if (now - client.msgWindowStart > 1000) {
      client.msgWindowStart = now;
      client.msgCount = 0;
    }
    client.msgCount++;
    if (client.msgCount > WS_MSG_RATE_LIMIT) {
      return;
    }

    const { type, payload } = message;

    switch (type) {
      case ClientMessage.AUTH:
        this.handleAuth(clientId, payload);
        break;
      case ClientMessage.START_MATCHING:
        if (client.isAuthenticated) this.handleStartMatching(clientId, payload);
        break;
      case ClientMessage.CANCEL_MATCHING:
        this.handleCancelMatching(clientId);
        break;
      case ClientMessage.START_AI_MATCH:
        if (client.isAuthenticated) this.handleStartAiMatch(clientId, payload);
        break;
      case ClientMessage.CREATE_PRIVATE_ROOM:
        if (client.isAuthenticated) this.handleCreatePrivateRoom(clientId, payload);
        break;
      case ClientMessage.JOIN_PRIVATE_ROOM:
        if (client.isAuthenticated) this.handleJoinPrivateRoom(clientId, payload);
        break;
      case ClientMessage.MAKE_CHOICE:
        if (client.isAuthenticated) this.handleMakeChoice(clientId, payload);
        break;
      case ClientMessage.RECONNECT:
        // 重连不需要预先 AUTH，凭 token 自行验证
        this.handleReconnect(clientId, payload);
        break;
      case ClientMessage.PING:
        client.lastPing = Date.now();
        this.sendToClient(client.ws, { type: ServerMessage.PONG, payload: {} });
        break;
      default:
        console.log(`[WebSocket] 未知消息类型: ${type}`);
    }
  }

  private handleAuth(clientId: string, payload: { token: string }): void {
    const client = this.clients.get(clientId);
    if (!client || !payload?.token) return;

    const decoded = verifyToken(payload.token);
    if (!decoded) {
      this.sendToClient(client.ws, { type: ServerMessage.AUTH_RESULT, payload: { success: false, error: 'Token 无效' } });
      return;
    }

    const user = db.findUserById(decoded.userId);
    if (!user) {
      this.sendToClient(client.ws, { type: ServerMessage.AUTH_RESULT, payload: { success: false, error: '用户不存在' } });
      return;
    }

    client.userId = user.id;
    client.username = user.username;
    client.nickname = user.nickname;
    client.rank = db.getStats(user.id)?.rank ?? 1000;
    client.isAuthenticated = true;
    onlineUsers.add(user.id);

    this.sendToClient(client.ws, {
      type: ServerMessage.AUTH_RESULT,
      payload: { success: true, userId: user.id, nickname: user.nickname },
    });

    console.log(`[WebSocket] 用户认证成功: ${user.nickname} (${user.username})`);
  }

  private handleStartMatching(clientId: string, payload: { mode: GameMode }): void {
    const client = this.clients.get(clientId);
    if (!client || client.isMatching || client.currentGameId) return;

    const mode = payload?.mode || GameMode.BEST_OF_3;
    if (!Object.values(GameMode).includes(mode)) {
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '无效的对局模式' } });
      return;
    }
    // 转去匹配对战时，取消其名下的私密房间
    this.removePendingRoomsOfHost(clientId);
    client.isMatching = true;
    client.matchingMode = mode;
    client.matchingSince = Date.now();

    // 尝试匹配
    const opponent = this.findOpponent(client, mode);
    if (opponent) {
      this.startGame(client, opponent, opponent.matchingMode || mode, false);
    } else {
      this.matchingQueue.push(client);
      this.sendToClient(client.ws, { type: ServerMessage.MATCHING, payload: { mode } });

      setTimeout(() => {
        if (client.isMatching && !client.currentGameId) {
          this.handleCancelMatching(clientId);
          this.sendToClient(client.ws, { type: ServerMessage.MATCH_TIMEOUT, payload: {} });
        }
      }, T.MATCH_TIMEOUT_MS());
    }
  }

  /**
   * 优先匹配同模式对手；同模式下按段位分差从小到大挑选（实力接近优先）。
   * 超过半个匹配超时仍无人时，放宽为任意模式（采用等待更久一方的模式开局），
   * 减少冷门模式的匹配超时。
   */
  private findOpponent(currentClient: ConnectedClient, mode: GameMode): ConnectedClient | null {
    const sameMode = this.matchingQueue
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.userId !== currentClient.userId && c.matchingMode === mode)
      .sort(
        (a, b) => Math.abs(a.c.rank - currentClient.rank) - Math.abs(b.c.rank - currentClient.rank)
      );
    if (sameMode.length > 0) {
      const opponent = sameMode[0].c;
      this.matchingQueue.splice(this.matchingQueue.indexOf(opponent), 1);
      return opponent;
    }

    const widenAfter = T.MATCH_TIMEOUT_MS() / 2;
    const relaxedIdx = this.matchingQueue.findIndex(
      (c) =>
        c.userId !== currentClient.userId &&
        c.matchingSince !== null &&
        Date.now() - c.matchingSince >= widenAfter
    );
    if (relaxedIdx >= 0) {
      const opponent = this.matchingQueue[relaxedIdx];
      this.matchingQueue.splice(relaxedIdx, 1);
      return opponent;
    }
    return null;
  }

  private handleCancelMatching(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.isMatching = false;
    client.matchingMode = null;
    client.matchingSince = null;
    const idx = this.matchingQueue.indexOf(client);
    if (idx >= 0) this.matchingQueue.splice(idx, 1);
  }

  private handleStartAiMatch(clientId: string, payload: { mode: GameMode; aiDifficulty?: AiDifficulty }): void {
    const client = this.clients.get(clientId);
    // 关键修复: 与真人匹配一致的防重入校验，避免重复创建房间导致重复结算战绩
    if (!client || client.isMatching || client.currentGameId) return;

    const mode = payload?.mode || GameMode.BEST_OF_3;
    if (!Object.values(GameMode).includes(mode)) {
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '无效的对局模式' } });
      return;
    }
    // 转去人机对战时，取消其名下的私密房间
    this.removePendingRoomsOfHost(clientId);
    const aiDifficulty: AiDifficulty =
      payload?.aiDifficulty === 'easy' || payload?.aiDifficulty === 'hard' ? payload.aiDifficulty : 'normal';

    const aiNickname = AI_NICKNAMES[Math.floor(Math.random() * AI_NICKNAMES.length)];
    const aiUser: DbUser = {
      id: 'ai-' + uuidv4(),
      username: aiNickname,
      passwordHash: '',
      nickname: aiNickname,
      avatar: null,
      createdAt: Date.now(),
    };

    // AI 不需要真实 WebSocket 连接
    const aiWs = { send: () => {}, close: () => {}, readyState: WebSocket.OPEN } as unknown as WebSocket;

    client.isMatching = false;
    this.startGame(
      client,
      { user: aiUser, ws: aiWs },
      mode,
      true,
      aiDifficulty
    );
  }

  // ---- 私密房间（邀请码对战） ----

  private handleCreatePrivateRoom(clientId: string, payload: { mode: GameMode }): void {
    const client = this.clients.get(clientId);
    if (!client || client.isMatching || client.currentGameId) return;

    const mode = payload?.mode || GameMode.BEST_OF_3;
    if (!Object.values(GameMode).includes(mode)) {
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '无效的对局模式' } });
      return;
    }

    // 一个玩家同时只保留一个待开始房间
    this.removePendingRoomsOfHost(clientId);

    const code = this.generateRoomCode();
    this.privateRooms.set(code, { code, hostClientId: clientId, mode, createdAt: Date.now() });

    this.sendToClient(client.ws, {
      type: ServerMessage.PRIVATE_ROOM_CREATED,
      payload: { code, mode } satisfies PrivateRoomCreatedPayload,
    });
    console.log(`[PrivateRoom] 房间已创建: ${code} (mode=${mode}, host=${client.nickname})`);
  }

  private handleJoinPrivateRoom(clientId: string, payload: { code: string }): void {
    const client = this.clients.get(clientId);
    if (!client || client.isMatching || client.currentGameId) return;

    const code = String(payload?.code || '').trim().toUpperCase();
    const room = this.privateRooms.get(code);
    if (!room || Date.now() - room.createdAt > PRIVATE_ROOM_TTL_MS) {
      this.privateRooms.delete(code);
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '房间不存在或已过期' } });
      return;
    }

    const host = this.clients.get(room.hostClientId);
    if (!host || host.isMatching || host.currentGameId) {
      this.privateRooms.delete(code);
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '房间已失效' } });
      return;
    }
    if (host.userId === client.userId) {
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '不能加入自己的房间' } });
      return;
    }

    // 成交：移除待开始房间，以房主为玩家1开局
    this.privateRooms.delete(code);
    this.sendToClient(host.ws, {
      type: ServerMessage.PRIVATE_ROOM_JOINED,
      payload: { code },
    });
    this.startGame(host, client, room.mode, false);
    console.log(`[PrivateRoom] ${client.nickname} 加入房间 ${code}，对局开始`);
  }

  private generateRoomCode(): string {
    let code: string;
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
    } while (this.privateRooms.has(code));
    return code;
  }

  /** 删除指定连接名下的所有待开始房间 */
  private removePendingRoomsOfHost(clientId: string): void {
    for (const [code, room] of this.privateRooms) {
      if (room.hostClientId === clientId) this.privateRooms.delete(code);
    }
  }

  /** 清理过期的私密房间（随心跳周期执行） */
  private sweepExpiredPrivateRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.privateRooms) {
      if (now - room.createdAt > PRIVATE_ROOM_TTL_MS) {
        this.privateRooms.delete(code);
        console.log(`[PrivateRoom] 房间过期清理: ${code}`);
      }
    }
  }

  private startGame(
    player1: ConnectedClient,
    player2: ConnectedClient | { user: DbUser; ws: WebSocket },
    mode: GameMode,
    isAi: boolean,
    aiDifficulty: AiDifficulty = 'normal'
  ): void {
    const gameId = uuidv4();
    const game: GameRoom = {
      id: gameId,
      mode,
      phase: GamePhase.PREPARATION,
      players: [
        {
          user: {
            id: player1.userId,
            username: player1.username,
            passwordHash: '',
            nickname: player1.nickname,
            avatar: null,
            createdAt: 0,
          },
          ws: player1.ws,
          choice: null,
          score: 0,
          connected: true,
        },
        {
          user: 'user' in player2
            ? player2.user
            : { id: player2.userId, username: player2.username, passwordHash: '', nickname: player2.nickname, avatar: null, createdAt: 0 },
          ws: player2.ws,
          choice: null,
          score: 0,
          connected: !isAi,
        },
      ],
      isAi,
      aiDifficulty,
      aiMemory: { counts: { [GameChoice.ROCK]: 0, [GameChoice.SCISSORS]: 0, [GameChoice.PAPER]: 0 }, lastPlayerChoice: null },
      roundNumber: 1,
      startedAt: Date.now(),
      phaseTimer: null,
      consecutiveDraws: 0,
      suddenDeath: false,
      suddenDeathDecided: false,
    };

    this.games.set(gameId, game);
    player1.currentGameId = gameId;
    player1.isMatching = false;
    player1.matchingMode = null;
    player1.matchingSince = null;
    this.userGames.set(player1.userId, gameId);
    if (!isAi && !('user' in player2)) {
      player2.currentGameId = gameId;
      player2.isMatching = false;
      player2.matchingMode = null;
      player2.matchingSince = null;
      this.userGames.set(player2.userId, gameId);
    }

    // 获取对手信息
    const opponentUser = 'user' in player2 ? player2.user : { id: player2.userId, nickname: player2.nickname, avatar: null as string | null };

    // 通知双方游戏开始
    const p1Payload = {
      gameId,
      mode,
      isAi,
      opponent: { id: opponentUser.id, nickname: opponentUser.nickname, avatar: opponentUser.avatar },
    };

    this.sendToClient(player1.ws, { type: ServerMessage.GAME_START, payload: p1Payload });

    if (!isAi) {
      (player2.ws as WebSocket).send(
        JSON.stringify({
          type: ServerMessage.GAME_START,
          payload: { ...p1Payload, opponent: { id: player1.userId, nickname: player1.nickname, avatar: null } },
        })
      );
    }

    // 开始游戏循环
    this.runGamePhase(gameId);
  }

  private runGamePhase(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const phase = game.phase;
    let duration = 0;

    switch (phase) {
      case GamePhase.PREPARATION:
        duration = T.PREPARATION_MS();
        this.broadcastPhaseUpdate(game, GamePhase.PREPARATION, duration);
        break;
      case GamePhase.SELECTING:
        duration = T.SELECTING_MS();
        this.broadcastPhaseUpdate(game, GamePhase.SELECTING, duration);
        break;
      case GamePhase.SETTLEMENT:
        duration = T.SETTLEMENT_MS();
        // 修复: 结算阶段也要广播 PHASE_UPDATE，客户端才能切换到结算视图
        this.broadcastPhaseUpdate(game, GamePhase.SETTLEMENT, duration);
        this.processSettlement(game);
        break;
      case GamePhase.BREAK:
        duration = T.BREAK_MS();
        this.broadcastPhaseUpdate(game, GamePhase.BREAK, duration);
        break;
      case GamePhase.FINISHED:
        this.processGameOver(game);
        return;
    }

    game.phaseTimer = setTimeout(() => {
      // AI 自动出拳
      if (game.isAi && phase === GamePhase.SELECTING && !game.players[1].choice) {
        game.players[1].choice = this.getAiChoice(game);
      }

      // 超时未选择随机出拳（固定出石头会被玩家针对挂机）
      if (phase === GamePhase.SELECTING) {
        if (!game.players[0].choice) {
          game.players[0].choice = ALL_CHOICES[Math.floor(Math.random() * ALL_CHOICES.length)];
        }
        if (!game.players[1].choice) {
          game.players[1].choice = ALL_CHOICES[Math.floor(Math.random() * ALL_CHOICES.length)];
        }
      }

      this.advancePhase(gameId);
    }, duration);
  }

  private advancePhase(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const phaseOrder = [GamePhase.PREPARATION, GamePhase.SELECTING, GamePhase.SETTLEMENT, GamePhase.BREAK];
    const currentIdx = phaseOrder.indexOf(game.phase);

    if (currentIdx < phaseOrder.length - 1) {
      game.phase = phaseOrder[currentIdx + 1];
    } else {
      // 一轮结束，检查游戏是否结束
      const winsRequired = Math.floor(game.mode / 2) + 1;
      const scoreReached =
        game.players[0].score >= winsRequired || game.players[1].score >= winsRequired;
      // 突然死亡：由结算阶段标记本轮已分出胜负
      if (scoreReached || game.suddenDeathDecided) {
        game.phase = GamePhase.FINISHED;
      } else {
        // 进入下一轮，重置选择
        game.roundNumber++;
        game.players[0].choice = null;
        game.players[1].choice = null;
        game.phase = GamePhase.PREPARATION;
      }
    }

    this.runGamePhase(gameId);
  }

  private processSettlement(game: GameRoom): void {
    const p1Choice = game.players[0].choice!;
    const p2Choice = game.players[1].choice!;

    // 记录真人玩家的出拳倾向，供困难 AI 下一轮参考
    game.aiMemory.counts[p1Choice]++;
    game.aiMemory.lastPlayerChoice = p1Choice;

    let result: RoundResult;
    if (p1Choice === p2Choice) {
      result = RoundResult.DRAW;
      game.consecutiveDraws++;
    } else {
      result =
        (p1Choice === GameChoice.ROCK && p2Choice === GameChoice.SCISSORS) ||
        (p1Choice === GameChoice.SCISSORS && p2Choice === GameChoice.PAPER) ||
        (p1Choice === GameChoice.PAPER && p2Choice === GameChoice.ROCK)
          ? RoundResult.WIN
          : RoundResult.LOSE;
      game.consecutiveDraws = 0;
    }

    // 连续 3 轮平局进入突然死亡：下一个非平局回合直接决定整场胜负
    if (game.consecutiveDraws >= 3) {
      game.suddenDeath = true;
    }
    if (game.suddenDeath && result !== RoundResult.DRAW) {
      game.suddenDeathDecided = true;
    }

    if (result === RoundResult.WIN) game.players[0].score++;
    else if (result === RoundResult.LOSE) game.players[1].score++;

    // 广播结果（玩家1视角）
    game.players[0].ws.send(
      JSON.stringify({
        type: ServerMessage.ROUND_RESULT,
        payload: {
          roundNumber: game.roundNumber,
          playerChoice: p1Choice,
          opponentChoice: p2Choice,
          result,
          playerScore: game.players[0].score,
          opponentScore: game.players[1].score,
        },
      })
    );

    // 玩家2视角（反转结果）
    if (!game.isAi) {
      const p2Result =
        result === RoundResult.DRAW ? RoundResult.DRAW : result === RoundResult.WIN ? RoundResult.LOSE : RoundResult.WIN;
      game.players[1].ws.send(
        JSON.stringify({
          type: ServerMessage.ROUND_RESULT,
          payload: {
            roundNumber: game.roundNumber,
            playerChoice: p2Choice,
            opponentChoice: p1Choice,
            result: p2Result,
            playerScore: game.players[1].score,
            opponentScore: game.players[0].score,
          },
        })
      );
    }
  }

  private processGameOver(game: GameRoom): void {
    const player1Won = game.players[0].score > game.players[1].score;
    const isDraw = game.players[0].score === game.players[1].score;
    const duration = Date.now() - game.startedAt;

    // 双方各自结算；AI 对局只结算真人玩家。
    // 段位分按 ELO 计算，需要先取双方更新前的分数（AI 视为 1000 分对手）
    const p1RankBefore = db.getStats(game.players[0].user.id)?.rank ?? 1000;
    const p2RankBefore = game.isAi
      ? 1000
      : (db.getStats(game.players[1].user.id)?.rank ?? 1000);

    const player1Stats = db.updateStatsAfterGame(
      game.players[0].user.id,
      isDraw ? null : player1Won,
      p2RankBefore
    );
    const player2Stats = game.isAi
      ? null
      : db.updateStatsAfterGame(game.players[1].user.id, isDraw ? null : !player1Won, p1RankBefore);

    // 添加游戏记录
    db.addGameRecord({
      id: uuidv4(),
      timestamp: Date.now(),
      mode: game.mode,
      player1Id: game.players[0].user.id,
      player2Id: game.isAi ? null : game.players[1].user.id,
      player1Won: isDraw ? false : player1Won,
      scorePlayer1: game.players[0].score,
      scorePlayer2: game.players[1].score,
      roundsCount: game.roundNumber,
      durationMs: duration,
    });

    const gameCountTitle = getGameCountTitle(player1Stats.totalGames);
    const winStreakTitle = getWinStreakTitle(player1Stats.currentWinStreak);

    const gameOverPayload = {
      gameId: game.id,
      playerWon: player1Won,
      isDraw,
      finalScore: { player: game.players[0].score, opponent: game.players[1].score },
      totalRounds: game.roundNumber,
      durationMs: duration,
      stats: player1Stats,
      titles: { gameCountTitle, winStreakTitle },
    };

    // 发送给玩家1
    this.sendToClient(game.players[0].ws, { type: ServerMessage.GAME_OVER, payload: gameOverPayload });

    // 发送给玩家2（反转胜负）
    if (!game.isAi) {
      const player2Won = !player1Won && !isDraw;
      this.sendToClient(game.players[1].ws, {
        type: ServerMessage.GAME_OVER,
        payload: {
          ...gameOverPayload,
          playerWon: player2Won,
          finalScore: { player: game.players[1].score, opponent: game.players[0].score },
          stats: player2Stats,
          titles: {
            gameCountTitle: getGameCountTitle(player2Stats!.totalGames),
            winStreakTitle: getWinStreakTitle(player2Stats!.currentWinStreak),
          },
        },
      });
    }

    // 修复: 清理游戏房间
    this.cleanupGame(game.id);
  }

  /**
   * 修复: 统一的房间清理方法，防止内存泄漏
   */
  private cleanupGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (game?.phaseTimer) {
      clearTimeout(game.phaseTimer);
    }
    this.games.delete(gameId);

    // 清理所有客户端引用与 userId 映射
    game?.players.forEach((p) => {
      if (this.userGames.get(p.user.id) === gameId) {
        this.userGames.delete(p.user.id);
      }
    });
    this.clients.forEach((client) => {
      if (client.currentGameId === gameId) {
        client.currentGameId = null;
      }
    });

    console.log(`[Game] 房间已清理: ${gameId}`);
  }

  /**
   * 断线重连：凭 token 找回进行中的对局，恢复状态并通知对手。
   * 无论是否有对局可恢复，都会完成该连接的认证（等价于 AUTH）。
   */
  private handleReconnect(clientId: string, payload: { token: string }): void {
    const client = this.clients.get(clientId);
    if (!client || !payload?.token) return;

    const decoded = verifyToken(payload.token);
    const user = decoded ? db.findUserById(decoded.userId) : null;
    if (!user) {
      this.sendToClient(client.ws, { type: ServerMessage.AUTH_RESULT, payload: { success: false, error: 'Token 无效' } });
      return;
    }

    client.userId = user.id;
    client.username = user.username;
    client.nickname = user.nickname;
    client.rank = db.getStats(user.id)?.rank ?? 1000;
    client.isAuthenticated = true;
    onlineUsers.add(user.id);

    const gameId = this.userGames.get(user.id);
    const game = gameId ? this.games.get(gameId) : undefined;
    if (!game || game.phase === GamePhase.FINISHED) {
      // 没有可恢复的对局，仅完成认证，客户端走正常匹配流程即可
      return;
    }

    const playerIdx = game.players.findIndex((p) => p.user.id === user.id);
    if (playerIdx < 0) return;

    const opponentIdx = playerIdx === 0 ? 1 : 0;
    client.currentGameId = game.id;
    game.players[playerIdx].ws = client.ws;
    game.players[playerIdx].connected = true;

    // 恢复信息（玩家自己的视角）
    const opponentUser = game.players[opponentIdx].user;
    this.sendToClient(client.ws, {
      type: ServerMessage.RECONNECT_SUCCESS,
      payload: {
        gameId: game.id,
        mode: game.mode,
        isAi: game.isAi,
        opponent: game.isAi
          ? null
          : { id: opponentUser.id, nickname: opponentUser.nickname, avatar: opponentUser.avatar ?? undefined },
        roundNumber: game.roundNumber,
        playerScore: game.players[playerIdx].score,
        opponentScore: game.players[opponentIdx].score,
        suddenDeath: game.suddenDeath,
      },
    });

    // 用当前阶段总时长重新开始本地倒计时
    const phaseDurations: Partial<Record<GamePhase, number>> = {
      [GamePhase.PREPARATION]: T.PREPARATION_MS(),
      [GamePhase.SELECTING]: T.SELECTING_MS(),
      [GamePhase.SETTLEMENT]: T.SETTLEMENT_MS(),
      [GamePhase.BREAK]: T.BREAK_MS(),
    };
    const duration = phaseDurations[game.phase] ?? 0;
    this.sendToClient(client.ws, {
      type: ServerMessage.PHASE_UPDATE,
      payload: {
        phase: game.phase,
        roundNumber: game.roundNumber,
        timeRemaining: duration,
        playerScore: game.players[playerIdx].score,
        opponentScore: game.players[opponentIdx].score,
        suddenDeath: game.suddenDeath,
      },
    });

    if (!game.isAi && game.players[opponentIdx].connected) {
      this.sendToClient(game.players[opponentIdx].ws, { type: ServerMessage.OPPONENT_RECONNECTED, payload: {} });
    }

    console.log(`[WebSocket] 重连成功，已恢复对局: ${user.nickname} -> ${game.id}`);
  }

  /**
   * 按难度出拳：
   * - easy: 偏向跟风玩家上一局的手势，随机性强
   * - normal: 纯随机
   * - hard: 统计玩家本局出拳频率并针对性克制，样本不足时结合上一局克制
   */
  private getAiChoice(game: GameRoom): GameChoice {
    const choices = [GameChoice.ROCK, GameChoice.SCISSORS, GameChoice.PAPER];
    const randomOf = () => choices[Math.floor(Math.random() * 3)];
    const memory = game.aiMemory;

    if (game.aiDifficulty === 'normal') return randomOf();

    if (game.aiDifficulty === 'easy') {
      if (memory.lastPlayerChoice && Math.random() < 0.4) {
        // 跟随玩家上一局的同一手势（容易被针对）
        return memory.lastPlayerChoice;
      }
      return randomOf();
    }

    // hard
    const total = memory.counts[GameChoice.ROCK] + memory.counts[GameChoice.SCISSORS] + memory.counts[GameChoice.PAPER];
    if (total >= 2 && Math.random() < 0.7) {
      let favorite: GameChoice = GameChoice.ROCK;
      for (const c of choices) {
        if (memory.counts[c] > memory.counts[favorite]) favorite = c;
      }
      return beatOf(favorite);
    }
    if (memory.lastPlayerChoice && Math.random() < 0.5) {
      return beatOf(memory.lastPlayerChoice);
    }
    return randomOf();
  }

  /**
   * 修复: 添加后端重复选择校验
   */
  private handleMakeChoice(clientId: string, payload: { choice: GameChoice }): void {
    const client = this.clients.get(clientId);
    if (!client || !client.currentGameId) return;

    const game = this.games.get(client.currentGameId);
    if (!game || game.phase !== GamePhase.SELECTING) return;
    if (!Object.values(GameChoice).includes(payload?.choice)) {
      this.sendToClient(client.ws, { type: ServerMessage.ERROR, payload: { error: '无效的出拳' } });
      return;
    }

    const playerIdx = game.players.findIndex((p) => p.user.id === client.userId);
    if (playerIdx < 0) return;

    // 关键修复: 后端校验是否已选择
    if (game.players[playerIdx].choice !== null) {
      console.log(`[Game] 重复选择被忽略: ${client.userId}`);
      return;
    }

    game.players[playerIdx].choice = payload.choice;

    // AI 对局: 玩家出拳后 AI 立即跟拳，无需干等倒计时
    if (game.isAi && !game.players[1].choice) {
      game.players[1].choice = this.getAiChoice(game);
    }

    // 双方都已选择，立即进入结算
    if (game.players[0].choice && game.players[1].choice) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phase = GamePhase.SETTLEMENT;
      this.runGamePhase(game.id);
    }
  }

  private handleDisconnect(clientId: string, closeCode?: number): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.isMatching) {
      this.handleCancelMatching(clientId);
    }

    // 处理游戏中断线
    if (client.currentGameId) {
      const game = this.games.get(client.currentGameId);
      if (game) {
        const playerIdx = game.players.findIndex((p) => p.user.id === client.userId);
        const player = playerIdx >= 0 ? game.players[playerIdx] : null;
        // 断线重连成功后旧连接才关闭的场景：玩家槽位的 ws 已被新连接接管，
        // 此时不能按离线处理（否则对手会看到误报的断线提示并被启动判负计时）
        if (player && game.phase !== GamePhase.FINISHED && player.ws === client.ws) {
          player.connected = false;
          const opponentIdx = playerIdx === 0 ? 1 : 0;
          if (!game.isAi) {
            this.sendToClient(game.players[opponentIdx].ws, { type: ServerMessage.OPPONENT_DISCONNECTED, payload: {} });
          }

          // 玩家主动正常关闭连接（code 1000）：视为弃局，立即判负；
          // 异常掉线则保留重连窗口，窗口内重连成功则自动回到对局。
          const delay = closeCode === 1000 ? 0 : T.RECONNECT_TIMEOUT_MS();
          setTimeout(() => {
            if (!player.connected && this.games.has(game.id) && game.phase !== GamePhase.FINISHED) {
              // 失踪者是输家（playerIdx），给其对手记分
              this.forfeitGame(game, playerIdx);
            }
          }, delay);
        }
      }
    }

    // 清理该连接名下的私密房间
    this.removePendingRoomsOfHost(clientId);

    if (!Array.from(this.clients.values()).some((other) => other.userId === client.userId && other.isAuthenticated)) {
      onlineUsers.delete(client.userId);
    }
    this.clients.delete(clientId);
    console.log(`[WebSocket] 用户断开: ${client.userId || clientId} (code: ${closeCode ?? 'unknown'})`);
  }

  /** 将局内一方直接判负并结束对局 */
  private forfeitGame(game: GameRoom, loserIdx: number): void {
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.players[loserIdx === 0 ? 1 : 0].score = Math.floor(game.mode / 2) + 1;
    game.phase = GamePhase.FINISHED;
    this.runGamePhase(game.id);
  }

  // ---- 工具方法 ----

  private sendToClient(ws: WebSocket, message: { type: ServerMessage; payload: any }): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 修复: 按玩家视角发送各自分数（玩家1看到自己的分为 playerScore，玩家2同理）
   */
  private broadcastPhaseUpdate(game: GameRoom, phase: GamePhase, duration: number): void {
    game.players.forEach((player, idx) => {
      const opponentIdx = idx === 0 ? 1 : 0;
      this.sendToClient(player.ws, {
        type: ServerMessage.PHASE_UPDATE,
        payload: {
          phase,
          roundNumber: game.roundNumber,
          timeRemaining: duration,
          playerScore: game.players[idx].score,
          opponentScore: game.players[opponentIdx].score,
          suddenDeath: game.suddenDeath,
        },
      });
    });
  }

  close(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.games.forEach((game) => {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
    });
    this.wss.close();
  }
}
