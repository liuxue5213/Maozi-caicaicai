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
  getGameCountTitle,
  getWinStreakTitle,
} from '@maozi/shared';
import { db, onlineUsers, DbUser } from '../db/database';
import { verifyToken } from '../utils/jwt';

// ============================================
// 连接与游戏状态
// ============================================

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  username: string;
  nickname: string;
  isAuthenticated: boolean;
  currentGameId: string | null;
  isMatching: boolean;
  matchingMode: GameMode | null;
  lastPing: number;
}

interface GameRoom {
  id: string;
  mode: GameMode;
  phase: GamePhase;
  players: { user: DbUser; ws: WebSocket; choice: GameChoice | null; score: number; connected: boolean }[];
  isAi: boolean;
  roundNumber: number;
  startedAt: number;
  phaseTimer: NodeJS.Timeout | null;
}

export class GameWebSocketServer {
  private clients: Map<string, ConnectedClient> = new Map();
  private games: Map<string, GameRoom> = new Map();
  private matchingQueue: ConnectedClient[] = [];
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
        isAuthenticated: false,
        currentGameId: null,
        isMatching: false,
        matchingMode: null,
        lastPing: Date.now(),
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

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] 连接错误:', error);
      });

      // 发送连接成功消息
      this.sendToClient(ws, { type: ServerMessage.AUTH_RESULT, payload: { connected: true, clientId } });
    });

    // 心跳检测（使用常量配置超时时间）
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
    }, GAME_TIMINGS.PING_INTERVAL_MS);

    console.log('[WebSocket] 游戏服务器已启动');
  }

  private handleMessage(clientId: string, message: { type: string; payload?: any }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

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
      case ClientMessage.MAKE_CHOICE:
        if (client.isAuthenticated) this.handleMakeChoice(clientId, payload);
        break;
      case ClientMessage.PING:
        client.lastPing = Date.now();
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
    client.isMatching = true;
    client.matchingMode = mode;

    // 尝试匹配
    const opponent = this.findOpponent(client, mode);
    if (opponent) {
      this.startGame(client, opponent, mode, false);
    } else {
      this.matchingQueue.push(client);
      this.sendToClient(client.ws, { type: ServerMessage.MATCHING, payload: { mode } });

      setTimeout(() => {
        if (client.isMatching && !client.currentGameId) {
          this.handleCancelMatching(clientId);
          this.sendToClient(client.ws, { type: ServerMessage.MATCH_TIMEOUT, payload: {} });
        }
      }, GAME_TIMINGS.MATCH_TIMEOUT_MS);
    }
  }

  /**
   * 修复: 改为普通方法，正确绑定 this
   */
  private findOpponent(currentClient: ConnectedClient, mode: GameMode): ConnectedClient | null {
    const idx = this.matchingQueue.findIndex(
      (c) => c.userId !== currentClient.userId && c.matchingMode === mode
    );
    if (idx >= 0) {
      const opponent = this.matchingQueue[idx];
      this.matchingQueue.splice(idx, 1);
      return opponent;
    }
    return null;
  }

  private handleCancelMatching(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.isMatching = false;
    client.matchingMode = null;
    const idx = this.matchingQueue.indexOf(client);
    if (idx >= 0) this.matchingQueue.splice(idx, 1);
  }

  private handleStartAiMatch(clientId: string, payload: { mode: GameMode }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const mode = payload?.mode || GameMode.BEST_OF_3;
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
      true
    );
  }

  private startGame(
    player1: ConnectedClient,
    player2: ConnectedClient | { user: DbUser; ws: WebSocket },
    mode: GameMode,
    isAi: boolean
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
            nickname: player1.username,
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
      roundNumber: 1,
      startedAt: Date.now(),
      phaseTimer: null,
    };

    this.games.set(gameId, game);
    player1.currentGameId = gameId;
    player1.isMatching = false;

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
          payload: { ...p1Payload, opponent: { id: player1.userId, nickname: player1.username, avatar: null } },
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
        duration = GAME_TIMINGS.PREPARATION_MS;
        this.broadcastPhaseUpdate(game, GamePhase.PREPARATION, duration);
        break;
      case GamePhase.SELECTING:
        duration = GAME_TIMINGS.SELECTING_MS;
        this.broadcastPhaseUpdate(game, GamePhase.SELECTING, duration);
        break;
      case GamePhase.SETTLEMENT:
        duration = GAME_TIMINGS.SETTLEMENT_MS;
        this.processSettlement(game);
        break;
      case GamePhase.BREAK:
        duration = GAME_TIMINGS.BREAK_MS;
        this.broadcastPhaseUpdate(game, GamePhase.BREAK, duration);
        break;
      case GamePhase.FINISHED:
        this.processGameOver(game);
        return;
    }

    game.phaseTimer = setTimeout(() => {
      // AI 自动出拳
      if (game.isAi && phase === GamePhase.SELECTING && !game.players[1].choice) {
        game.players[1].choice = this.getAiChoice();
      }

      // 超时未选择默认给石头
      if (phase === GamePhase.SELECTING) {
        if (!game.players[0].choice) game.players[0].choice = GameChoice.ROCK;
        if (!game.players[1].choice) game.players[1].choice = GameChoice.ROCK;
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
      if (game.players[0].score >= winsRequired || game.players[1].score >= winsRequired) {
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

    let result: RoundResult;
    if (p1Choice === p2Choice) {
      result = RoundResult.DRAW;
    } else if (
      (p1Choice === GameChoice.ROCK && p2Choice === GameChoice.SCISSORS) ||
      (p1Choice === GameChoice.SCISSORS && p2Choice === GameChoice.PAPER) ||
      (p1Choice === GameChoice.PAPER && p2Choice === GameChoice.ROCK)
    ) {
      result = RoundResult.WIN;
      game.players[0].score++;
    } else {
      result = RoundResult.LOSE;
      game.players[1].score++;
    }

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

    // 更新数据库（修复平局处理）
    const userStats = db.updateStatsAfterGame(
      game.players[0].user.id,
      isDraw ? null : player1Won
    );

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

    const gameCountTitle = getGameCountTitle(userStats.totalGames);
    const winStreakTitle = getWinStreakTitle(userStats.currentWinStreak);

    const gameOverPayload = {
      gameId: game.id,
      playerWon: player1Won,
      isDraw,
      finalScore: { player: game.players[0].score, opponent: game.players[1].score },
      totalRounds: game.roundNumber,
      durationMs: duration,
      stats: userStats,
      titles: { gameCountTitle, winStreakTitle },
    };

    // 发送给玩家1
    game.players[0].ws.send(JSON.stringify({ type: ServerMessage.GAME_OVER, payload: gameOverPayload }));

    // 发送给玩家2（反转胜负）
    if (!game.isAi) {
      game.players[1].ws.send(
        JSON.stringify({
          type: ServerMessage.GAME_OVER,
          payload: { ...gameOverPayload, playerWon: !player1Won && !isDraw },
        })
      );
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

    // 清理所有客户端引用
    this.clients.forEach((client) => {
      if (client.currentGameId === gameId) {
        client.currentGameId = null;
      }
    });

    console.log(`[Game] 房间已清理: ${gameId}`);
  }

  private getAiChoice(): GameChoice {
    const choices = [GameChoice.ROCK, GameChoice.SCISSORS, GameChoice.PAPER];
    return choices[Math.floor(Math.random() * 3)];
  }

  /**
   * 修复: 添加后端重复选择校验
   */
  private handleMakeChoice(clientId: string, payload: { choice: GameChoice }): void {
    const client = this.clients.get(clientId);
    if (!client || !client.currentGameId) return;

    const game = this.games.get(client.currentGameId);
    if (!game || game.phase !== GamePhase.SELECTING) return;

    const playerIdx = game.players.findIndex((p) => p.user.id === client.userId);
    if (playerIdx < 0) return;

    // 关键修复: 后端校验是否已选择
    if (game.players[playerIdx].choice !== null) {
      console.log(`[Game] 重复选择被忽略: ${client.userId}`);
      return;
    }

    game.players[playerIdx].choice = payload.choice;

    // 双方都已选择，立即进入结算
    if (game.players[0].choice && game.players[1].choice) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phase = GamePhase.SETTLEMENT;
      this.runGamePhase(game.id);
    }
  }

  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.isMatching) {
      this.handleCancelMatching(clientId);
    }

    // 处理游戏中断线
    if (client.currentGameId) {
      const game = this.games.get(client.currentGameId);
      if (game) {
        const player = game.players.find((p) => p.user.id === client.userId);
        if (player) {
          player.connected = false;
          const opponent = game.players.find((p) => p.user.id !== client.userId);
          if (opponent && !game.isAi) {
            opponent.ws.send(JSON.stringify({ type: ServerMessage.OPPONENT_DISCONNECTED, payload: {} }));
          }

          // 重连超时
          setTimeout(() => {
            if (!player.connected && this.games.has(game.id)) {
              if (game.phaseTimer) clearTimeout(game.phaseTimer);
              // 超时判负
              const opponent = game.players.find((p) => p.user.id !== client.userId);
              if (opponent) opponent.score = Math.floor(game.mode / 2) + 1;
              game.phase = GamePhase.FINISHED;
              this.runGamePhase(game.id);
            }
          }, GAME_TIMINGS.RECONNECT_TIMEOUT_MS);
        }
      }
    }

    onlineUsers.delete(client.userId);
    this.clients.delete(clientId);
    console.log(`[WebSocket] 用户断开: ${client.userId || clientId}`);
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
        },
      });
    });
  }

  private broadcastToGame(game: GameRoom, message: { type: ServerMessage; payload: any }): void {
    const msg = JSON.stringify(message);
    game.players.forEach((player) => {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(msg);
      }
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
