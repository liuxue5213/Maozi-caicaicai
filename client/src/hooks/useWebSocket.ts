import { useEffect, useRef, useCallback, useState } from 'react';
import { ClientMessage, ServerMessage, GameChoice, GameMode, GamePhase, AiDifficulty } from '@maozi/shared';
import { WS_BASE_URL } from '../api/client';
import { useAuthStore } from '../store/authStore';

interface WebSocketMessage {
  type: ServerMessage;
  payload: any;
}

interface UseWebSocketOptions {
  onGameStart?: (payload: any) => void;
  onPhaseUpdate?: (payload: any) => void;
  onRoundResult?: (payload: any) => void;
  onGameOver?: (payload: any) => void;
  onMatching?: (payload: any) => void;
  onMatchTimeout?: () => void;
  onOpponentDisconnected?: () => void;
  onOpponentReconnected?: () => void;
  /** 断线重连成功，服务器返回进行中对局的恢复状态 */
  onReconnectSuccess?: (payload: any) => void;
  /** 私密房间已创建（房主收到，携带邀请码） */
  onPrivateRoomCreated?: (payload: any) => void;
  /** 好友加入私密房间，对局即将开始（房主收到） */
  onPrivateRoomJoined?: (payload: any) => void;
  onAuthResult?: (payload: any) => void;
  onError?: (error: string) => void;
}

/**
 * WebSocket 连接钩子
 * 修复: 认证竞态条件、重连重认证、心跳机制
 */
export function useWebSocket(options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // 使用 ref 保持 options 最新
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * 处理收到的消息
   */
  const handleMessage = useCallback((message: WebSocketMessage) => {
    const opts = optionsRef.current;
    switch (message.type) {
      case ServerMessage.AUTH_RESULT:
        if (message.payload?.success) {
          setIsAuthenticated(true);
        }
        opts.onAuthResult?.(message.payload);
        break;
      case ServerMessage.MATCHING:
        opts.onMatching?.(message.payload);
        break;
      case ServerMessage.GAME_START:
        opts.onGameStart?.(message.payload);
        break;
      case ServerMessage.PHASE_UPDATE:
        opts.onPhaseUpdate?.(message.payload);
        break;
      case ServerMessage.ROUND_RESULT:
        opts.onRoundResult?.(message.payload);
        break;
      case ServerMessage.GAME_OVER:
        opts.onGameOver?.(message.payload);
        break;
      case ServerMessage.MATCH_TIMEOUT:
        opts.onMatchTimeout?.();
        break;
      case ServerMessage.OPPONENT_DISCONNECTED:
        opts.onOpponentDisconnected?.();
        break;
      case ServerMessage.OPPONENT_RECONNECTED:
        opts.onOpponentReconnected?.();
        break;
      case ServerMessage.RECONNECT_SUCCESS:
        opts.onReconnectSuccess?.(message.payload);
        break;
      case ServerMessage.PRIVATE_ROOM_CREATED:
        opts.onPrivateRoomCreated?.(message.payload);
        break;
      case ServerMessage.PRIVATE_ROOM_JOINED:
        opts.onPrivateRoomJoined?.(message.payload);
        break;
      case ServerMessage.ERROR:
        opts.onError?.(message.payload?.error || '未知错误');
        break;
    }
  }, []);

  /**
   * 连接 WebSocket
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || isConnecting) return;

    setIsConnecting(true);
    const ws = new WebSocket(WS_BASE_URL);

    ws.onopen = () => {
      console.log('[WebSocket] 连接成功');
      setIsConnected(true);
      setIsConnecting(false);
      reconnectAttempts.current = 0;

      // 修复: 每次连接（包括重连）都立即发送认证
      const token = useAuthStore.getState().token;
      if (token) {
        ws.send(JSON.stringify({ type: ClientMessage.AUTH, payload: { token } }));
        // 若存在因断线中断的对局，尝试恢复（服务器无对局时静默忽略）
        ws.send(JSON.stringify({ type: ClientMessage.RECONNECT, payload: { token } }));
      }

      // 修复: 启动心跳（客户端发送 PING）
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: ClientMessage.PING }));
        }
      }, 15000);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (e) {
        console.error('[WebSocket] 消息解析失败:', e);
      }
    };

    ws.onclose = (event) => {
      console.log(`[WebSocket] 连接关闭 (code: ${event.code}, reason: ${event.reason})`);
      setIsConnected(false);
      setIsAuthenticated(false);
      wsRef.current = null;

      // 停止心跳
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // 自动重连（带退避）
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        console.log(`[WebSocket] ${delay}ms 后重连 (第 ${reconnectAttempts.current} 次)`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.error('[WebSocket] 达到最大重连次数，停止重连');
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] 错误:', error);
      setIsConnecting(false);
    };

    wsRef.current = ws;
  }, [isConnecting, handleMessage]);

  /**
   * 断开连接
   */
  const disconnect = useCallback(() => {
    // 清除重连定时器
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    // 清除心跳
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    // 重置重连计数
    reconnectAttempts.current = maxReconnectAttempts;
    // 关闭连接
    if (wsRef.current) {
      wsRef.current.close(1000, '客户端主动断开');
      wsRef.current = null;
    }
  }, []);

  /**
   * 发送消息
   */
  const sendMessage = useCallback((type: ClientMessage, payload?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('[WebSocket] 连接未就绪，消息未发送:', type);
    }
  }, []);

  // 游戏相关便捷方法
  const startMatching = useCallback(
    (mode: GameMode) => {
      sendMessage(ClientMessage.START_MATCHING, { mode });
    },
    [sendMessage]
  );

  const cancelMatching = useCallback(() => {
    sendMessage(ClientMessage.CANCEL_MATCHING);
  }, [sendMessage]);

  const startAiMatch = useCallback(
    (mode: GameMode, aiDifficulty?: AiDifficulty) => {
      sendMessage(ClientMessage.START_AI_MATCH, { mode, aiDifficulty });
    },
    [sendMessage]
  );

  const makeChoice = useCallback(
    (choice: GameChoice) => {
      sendMessage(ClientMessage.MAKE_CHOICE, { choice });
    },
    [sendMessage]
  );

  const createPrivateRoom = useCallback(
    (mode: GameMode) => {
      sendMessage(ClientMessage.CREATE_PRIVATE_ROOM, { mode });
    },
    [sendMessage]
  );

  const joinPrivateRoom = useCallback(
    (code: string) => {
      sendMessage(ClientMessage.JOIN_PRIVATE_ROOM, { code });
    },
    [sendMessage]
  );

  // 清理
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isAuthenticated,
    isConnecting,
    connect,
    disconnect,
    sendMessage,
    startMatching,
    cancelMatching,
    startAiMatch,
    makeChoice,
    createPrivateRoom,
    joinPrivateRoom,
  };
}
