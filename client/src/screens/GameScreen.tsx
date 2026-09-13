import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { GameChoice, GameMode, GamePhase, AiDifficulty, RoundResult } from '@maozi/shared';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuthStore } from '../store/authStore';
import { playSound } from '../utils/sounds';

interface GameParams {
  mode: GameMode;
  matchType: 'online' | 'ai' | 'private';
  difficulty?: AiDifficulty;
  /** matchType === 'private' 时：create=建房 / join=凭码进房 */
  privateAction?: 'create' | 'join';
  /** matchType === 'private' && privateAction === 'join' 时的邀请码 */
  roomCode?: string;
}

const CHOICES: GameChoice[] = [GameChoice.ROCK, GameChoice.SCISSORS, GameChoice.PAPER];

/** 结算阶段"石头—剪刀—布"蓄力拍数与节拍时长（毫秒），需小于 SETTLEMENT_MS(3000) */
const PUMP_BEATS = ['石头', '剪刀', '布'] as const;
const PUMP_BEAT_MS = 450;

/** 从双方手势推算玩家本局胜负（服务器未返回 result 时的兜底） */
function judgeRound(player: GameChoice, opponent: GameChoice): RoundResult {
  if (player === opponent) return RoundResult.DRAW;
  const wins =
    (player === GameChoice.ROCK && opponent === GameChoice.SCISSORS) ||
    (player === GameChoice.SCISSORS && opponent === GameChoice.PAPER) ||
    (player === GameChoice.PAPER && opponent === GameChoice.ROCK);
  return wins ? RoundResult.WIN : RoundResult.LOSE;
}

const CONFETTI_COLORS = ['#6200EE', '#03DAC6', '#FF7043', '#FFD600', '#4CAF50', '#2196F3'];

interface ConfettiPieceProps {
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  drift: number;
}

function ConfettiPiece({ left, delay, duration, size, color, drift }: ConfettiPieceProps) {
  const y = useRef(new Animated.Value(-40)).current;
  const x = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, {
        toValue: 900,
        duration,
        delay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(x, {
        toValue: drift,
        duration,
        delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(rotate, {
        toValue: 720,
        duration,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [y, x, rotate, delay, duration, drift]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: `${left}%`,
        top: 0,
        width: size,
        height: size * 0.45,
        borderRadius: 2,
        backgroundColor: color,
        transform: [
          { translateX: x },
          { translateY: y },
          {
            rotate: rotate.interpolate({
              inputRange: [0, 720],
              outputRange: ['0deg', '720deg'],
            }),
          },
        ],
      }}
    />
  );
}

/** 轻量彩带特效：整局获胜时从顶部撒落一次性纸屑（无第三方依赖） */
function Confetti({ count = 40 }: { count?: number }) {
  const pieces = useMemo<Omit<ConfettiPieceProps, 'key'>[]>(
    () =>
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 600,
        duration: 2200 + Math.random() * 1600,
        size: 7 + Math.random() * 7,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        drift: (Math.random() - 0.5) * 120,
      })),
    [count]
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <ConfettiPiece key={i} {...p} />
      ))}
    </View>
  );
}

export function GameScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { mode, matchType, difficulty, privateAction, roomCode } = (route.params || {
    mode: GameMode.BEST_OF_3,
    matchType: 'online',
  }) as GameParams;

  const { user, setStats } = useAuthStore();

  // 游戏状态
  const [phase, setPhase] = useState<GamePhase>(GamePhase.WAITING);
  const [roundNumber, setRoundNumber] = useState(1);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [localEndTime, setLocalEndTime] = useState(0); // 本地倒计时目标时间
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [playerChoice, setPlayerChoice] = useState<GameChoice | null>(null);
  const [opponentChoice, setOpponentChoice] = useState<GameChoice | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [opponentNickname, setOpponentNickname] = useState<string>('');
  const [gameResult, setGameResult] = useState<{ won: boolean; isDraw: boolean } | null>(null);
  const [opponentOffline, setOpponentOffline] = useState(false);
  const [roundHistory, setRoundHistory] = useState<RoundResult[]>([]);
  const [rankDelta, setRankDelta] = useState<number | null>(null);
  const [suddenDeath, setSuddenDeath] = useState(false);
  /** 私密房间：房主收到的邀请码（非空表示等待好友加入） */
  const [privateRoomCode, setPrivateRoomCode] = useState<string | null>(null);
  /** 结算动画：'pump' = 石头剪刀布蓄力拍，'reveal' = 亮出真实手势 */
  const [revealStage, setRevealStage] = useState<'pump' | 'reveal'>('reveal');
  const [pumpBeat, setPumpBeat] = useState(0);

  // 定时器 refs
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pumpTimersRef = useRef<NodeJS.Timeout[]>([]);
  const privateInitiatedRef = useRef(false);
  const choiceLockedRef = useRef(false);
  const phaseTotalRef = useRef(10000); // 当前阶段总时长，用于倒计时进度条比例
  // phase 的实时镜像，供不重建的回调读取最新阶段
  const phaseRef = useRef<GamePhase>(GamePhase.WAITING);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // 结算揭晓动画
  const revealAnim = useRef(new Animated.Value(0)).current;
  // 蓄力拍缩放（两个拳头上抬再落下）
  const pumpAnim = useRef(new Animated.Value(1)).current;

  // WebSocket 回调
  const handleGameStart = useCallback((payload: any) => {
    setIsMatching(false);
    setPhase(GamePhase.PREPARATION);
    setRoundNumber(1);
    setPlayerScore(0);
    setOpponentScore(0);
    setPlayerChoice(null);
    setOpponentChoice(null);
    setGameResult(null);
    setOpponentOffline(false);
    setRoundHistory([]);
    setRankDelta(null);
    setSuddenDeath(false);
    setPrivateRoomCode(null);
    choiceLockedRef.current = false;
    if (payload.opponent) {
      setOpponentNickname(payload.opponent.nickname || '对手');
    }
  }, []);

  const handlePhaseUpdate = useCallback((payload: any) => {
    setPhase(payload.phase);
    setRoundNumber(payload.roundNumber);
    setTimeRemaining(payload.timeRemaining);
    phaseTotalRef.current = Math.max(payload.timeRemaining, 1000);
    setLocalEndTime(Date.now() + payload.timeRemaining); // 设置本地倒计时
    setPlayerScore(payload.playerScore);
    setOpponentScore(payload.opponentScore);
    setSuddenDeath(Boolean(payload.suddenDeath));

    // 进入新一轮选择：清空上一轮的出拳状态
    if (payload.phase === GamePhase.SELECTING) {
      setPlayerChoice(null);
      setOpponentChoice(null);
      choiceLockedRef.current = false;
    }
  }, []);

  const handleRoundResult = useCallback((payload: any) => {
    setPlayerChoice(payload.playerChoice);
    setOpponentChoice(payload.opponentChoice);
    setPlayerScore(payload.playerScore);
    setOpponentScore(payload.opponentScore);
    const result: RoundResult =
      payload.result ?? judgeRound(payload.playerChoice, payload.opponentChoice);
    setRoundHistory((prev) => {
      const next = [...prev];
      next[payload.roundNumber - 1] = result;
      return next;
    });
    playSound(result === RoundResult.WIN ? 'win' : result === RoundResult.LOSE ? 'lose' : 'draw');
    // 单轮结果震动反馈（平台不支持时静默忽略）
    Haptics.notificationAsync(
      result === RoundResult.WIN
        ? Haptics.NotificationFeedbackType.Success
        : result === RoundResult.LOSE
          ? Haptics.NotificationFeedbackType.Error
          : Haptics.NotificationFeedbackType.Warning
    ).catch(() => {});
  }, []);

  const handleGameOver = useCallback(
    (payload: any) => {
      setPhase(GamePhase.FINISHED);
      setPlayerScore(payload.finalScore?.player ?? 0);
      setOpponentScore(payload.finalScore?.opponent ?? 0);
      setGameResult({ won: payload.playerWon, isDraw: Boolean(payload.isDraw) });
      playSound(payload.isDraw ? 'draw' : payload.playerWon ? 'game-win' : 'game-lose');
      if (!payload.isDraw) {
        Haptics.notificationAsync(
          payload.playerWon
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error
        ).catch(() => {});
      }
      const prevRank = useAuthStore.getState().stats?.rank;
      if (typeof prevRank === 'number' && typeof payload.stats?.rank === 'number') {
        setRankDelta(payload.stats.rank - prevRank);
      }
      if (payload.stats) {
        setStats(payload.stats);
      }
    },
    [setStats]
  );

  const handleMatching = useCallback(() => {
    setIsMatching(true);
  }, []);

  const handleMatchTimeout = useCallback(() => {
    setIsMatching(false);
    Alert.alert('匹配超时', '暂时没有匹配到对手，请重试', [
      { text: '确定', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  const handleOpponentDisconnected = useCallback(() => {
    setOpponentOffline(true);
  }, []);

  const handleOpponentReconnected = useCallback(() => {
    setOpponentOffline(false);
  }, []);

  /** 房主：私密房间创建成功，展示邀请码等待好友 */
  const handlePrivateRoomCreated = useCallback((payload: any) => {
    setIsMatching(false);
    setPrivateRoomCode(payload?.code || '');
  }, []);

  /** 房主：好友已入房，服务器紧接着会推送 GAME_START */
  const handlePrivateRoomJoined = useCallback(() => {
    setPrivateRoomCode(null);
  }, []);

  /** 私密房间流程出错（房间不存在/已失效等）：提示并返回 */
  const handleWsError = useCallback(
    (error: string) => {
      if (matchType === 'private' && phaseRef.current === GamePhase.WAITING) {
        Alert.alert('无法进入房间', error, [
          { text: '确定', onPress: () => navigation.goBack() },
        ]);
      }
    },
    [matchType, navigation]
  );

  /** 断线恢复：按服务器返回的对局状态重建界面 */
  const handleReconnectSuccess = useCallback((payload: any) => {
    setIsMatching(false);
    setGameResult(null);
    setRoundNumber(payload.roundNumber ?? 1);
    setPlayerScore(payload.playerScore ?? 0);
    setOpponentScore(payload.opponentScore ?? 0);
    setPlayerChoice(null);
    setOpponentChoice(null);
    setRankDelta(null);
    setSuddenDeath(Boolean(payload.suddenDeath));
    choiceLockedRef.current = false;
    if (payload.opponent?.nickname) {
      setOpponentNickname(payload.opponent.nickname);
    }
  }, []);

  // WebSocket 钩子
  const ws = useWebSocket({
    onGameStart: handleGameStart,
    onPhaseUpdate: handlePhaseUpdate,
    onRoundResult: handleRoundResult,
    onGameOver: handleGameOver,
    onMatching: handleMatching,
    onMatchTimeout: handleMatchTimeout,
    onOpponentDisconnected: handleOpponentDisconnected,
    onOpponentReconnected: handleOpponentReconnected,
    onReconnectSuccess: handleReconnectSuccess,
    onPrivateRoomCreated: handlePrivateRoomCreated,
    onPrivateRoomJoined: handlePrivateRoomJoined,
    onError: handleWsError,
  });

  // 本地倒计时定时器（修复: 减少服务器时间不同步的影响）
  useEffect(() => {
    if (phase !== GamePhase.SELECTING && phase !== GamePhase.PREPARATION) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, localEndTime - Date.now());
      setTimeRemaining(remaining);
    }, 100);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [phase, localEndTime]);

  // 结算阶段：先播放"石头—剪刀—布"蓄力拍，再亮出双方真实手势
  useEffect(() => {
    if (phase !== GamePhase.SETTLEMENT) return;

    const clearPumpTimers = () => {
      pumpTimersRef.current.forEach(clearTimeout);
      pumpTimersRef.current = [];
    };

    revealAnim.setValue(0);
    setRevealStage('pump');
    setPumpBeat(0);

    PUMP_BEATS.forEach((_beat, idx) => {
      pumpTimersRef.current.push(
        setTimeout(() => {
          setPumpBeat(idx);
          pumpAnim.setValue(1.25);
          Animated.timing(pumpAnim, {
            toValue: 1,
            duration: PUMP_BEAT_MS - 60,
            easing: Easing.bounce,
            useNativeDriver: true,
          }).start();
        }, idx * PUMP_BEAT_MS)
      );
    });

    // 蓄力拍结束，揭晓真实手势
    pumpTimersRef.current.push(
      setTimeout(() => {
        setRevealStage('reveal');
        Animated.spring(revealAnim, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
      }, PUMP_BEATS.length * PUMP_BEAT_MS)
    );

    return clearPumpTimers;
  }, [phase, revealAnim, pumpAnim]);

  // 连接 WebSocket
  useEffect(() => {
    ws.connect();
    return () => ws.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 连接断开后允许重新建房/进房：重连成功后由匹配 useEffect 重新发起
  useEffect(() => {
    if (!ws.isConnected) privateInitiatedRef.current = false;
  }, [ws.isConnected]);

  // 修复: 等待认证通过后再开始匹配/建房（唯一触发点，避免重复发送请求）
  useEffect(() => {
    if (!ws.isConnected || !ws.isAuthenticated || phase !== GamePhase.WAITING) return;

    if (matchType === 'private') {
      // 建房/进房只发一次：失败时由 onError 弹窗返回，避免无限重试
      if (privateInitiatedRef.current) return;
      privateInitiatedRef.current = true;
      if (privateAction === 'join' && roomCode) {
        ws.joinPrivateRoom(roomCode);
      } else {
        ws.createPrivateRoom(mode);
      }
      return;
    }

    if (!isMatching && !gameResult) {
      if (matchType === 'ai') {
        ws.startAiMatch(mode, difficulty);
      } else {
        ws.startMatching(mode);
      }
    }
  }, [ws.isConnected, ws.isAuthenticated, isMatching, phase, gameResult, matchType, mode, difficulty, privateAction, roomCode]);

  // 点选手势并立即锁定（服务器会忽略重复选择）
  const confirmChoice = (choice: GameChoice) => {
    if (choiceLockedRef.current || phase !== GamePhase.SELECTING) return;
    choiceLockedRef.current = true;
    Haptics.selectionAsync().catch(() => {});
    setPlayerChoice(choice);
    playSound('choice');
    ws.makeChoice(choice);
  };

  /** 对局进行中退出将被判负，需要确认 */
  const isGameInProgress = (phase: GamePhase) =>
    phase === GamePhase.PREPARATION ||
    phase === GamePhase.SELECTING ||
    phase === GamePhase.SETTLEMENT ||
    phase === GamePhase.BREAK;

  const handleQuitPress = () => {
    if (!isGameInProgress(phase)) {
      navigation.goBack();
      return;
    }
    Alert.alert('退出对局', '当前对局尚未结束，中途退出将被判负，确定退出吗？', [
      { text: '继续比赛', style: 'cancel' },
      { text: '退出并判负', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  // 获取选择对应的 emoji
  const getChoiceEmoji = (choice: GameChoice | null) => {
    if (!choice) return '❓';
    switch (choice) {
      case GameChoice.ROCK: return '✊';
      case GameChoice.SCISSORS: return '✌️';
      case GameChoice.PAPER: return '✋';
    }
  };

  // 获取选择对应的文字
  const getChoiceText = (choice: GameChoice | null) => {
    if (!choice) return '等待...';
    switch (choice) {
      case GameChoice.ROCK: return '石头';
      case GameChoice.SCISSORS: return '剪刀';
      case GameChoice.PAPER: return '布';
    }
  };

  /** 倒计时是否进入最后 3 秒的紧迫状态 */
  const timerUrgent = phase === GamePhase.SELECTING && timeRemaining > 0 && timeRemaining <= 3000;

  // 渲染不同阶段
  const renderPhase = () => {
    switch (phase) {
      case GamePhase.WAITING:
        // 私密房间：房主等待好友凭邀请码加入
        if (privateRoomCode !== null) {
          return (
            <View style={styles.centerContent}>
              <Text style={styles.phaseEmoji}>🔒</Text>
              <Text style={styles.phaseText}>等待好友加入</Text>
              <View style={styles.roomCodeCard}>
                <Text style={styles.roomCodeLabel}>房间邀请码</Text>
                <Text style={styles.roomCodeText}>{privateRoomCode}</Text>
              </View>
              <Text style={styles.hintText}>把邀请码发给好友，输入后立即开局</Text>
            </View>
          );
        }
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#6200EE" />
            <Text style={styles.phaseText}>
              {isMatching ? '正在匹配对手...' : '正在连接服务器...'}
            </Text>
          </View>
        );

      case GamePhase.PREPARATION:
        return (
          <View style={styles.centerContent}>
            <Text style={styles.phaseEmoji}>⚔️</Text>
            <Text style={styles.phaseText}>准备开始</Text>
            <Text style={styles.timerText}>{Math.ceil(timeRemaining / 1000)}s</Text>
          </View>
        );

      case GamePhase.SELECTING:
        return (
          <View style={styles.selectingContent}>
            {/* 对手选择 */}
            <View style={styles.opponentArea}>
              <View style={styles.choiceCircle}>
                <Text style={styles.choiceEmoji}>{getChoiceEmoji(opponentChoice)}</Text>
              </View>
              <Text style={styles.playerName}>{opponentNickname || '对手'}</Text>
            </View>

            {/* 倒计时进度条 */}
            <View style={styles.timerBar}>
              <View
                style={[
                  styles.timerProgress,
                  {
                    width: `${Math.min(100, (timeRemaining / phaseTotalRef.current) * 100)}%`,
                    backgroundColor: timerUrgent ? '#E53935' : '#FF9800',
                  },
                ]}
              />
            </View>
            <Text style={[styles.timerText, styles.timerTextSmall, timerUrgent && styles.timerTextUrgent]}>
              {Math.ceil(timeRemaining / 1000)}s
            </Text>

            {/* 玩家直接点选出手势 */}
            <View style={styles.choiceRow}>
              {CHOICES.map((choice) => {
                const isSelected = playerChoice === choice;
                const isLocked = !!playerChoice;
                return (
                  <TouchableOpacity
                    key={choice}
                    style={[
                      styles.choiceOption,
                      isSelected && styles.choiceOptionSelected,
                      isLocked && !isSelected && styles.choiceOptionDimmed,
                    ]}
                    onPress={() => confirmChoice(choice)}
                    disabled={isLocked}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.choiceOptionEmoji}>{getChoiceEmoji(choice)}</Text>
                    <Text
                      style={[
                        styles.choiceOptionText,
                        isSelected && styles.choiceOptionTextSelected,
                      ]}
                    >
                      {getChoiceText(choice)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hintText}>
              {playerChoice ? '已选择，等待对手出拳...' : '点击手势立即出拳'}
            </Text>
          </View>
        );

      case GamePhase.SETTLEMENT: {
        const lastResult =
          roundHistory[roundNumber - 1] ??
          (playerChoice && opponentChoice ? judgeRound(playerChoice, opponentChoice) : null);
        const isPump = revealStage === 'pump';
        return (
          <View style={styles.centerContent}>
            <Text style={styles.roundText}>第 {roundNumber} 轮结算</Text>
            <Animated.View
              style={[
                styles.settlementRow,
                { transform: [{ scale: isPump ? pumpAnim : revealAnim }] },
              ]}
            >
              <View style={[styles.choiceCircle, styles.choiceCircleLarge]}>
                <Text style={[styles.choiceEmoji, styles.choiceEmojiLarge]}>
                  {isPump ? '✊' : getChoiceEmoji(playerChoice)}
                </Text>
              </View>
              <Text style={styles.versusText}>VS</Text>
              <View style={[styles.choiceCircle, styles.choiceCircleLarge]}>
                <Text style={[styles.choiceEmoji, styles.choiceEmojiLarge]}>
                  {isPump ? '✊' : getChoiceEmoji(opponentChoice)}
                </Text>
              </View>
            </Animated.View>
            <View style={styles.settlementNames}>
              <Text style={styles.playerName}>{user?.nickname || '我'}</Text>
              <Text style={styles.playerName}>{opponentNickname || '对手'}</Text>
            </View>
            {isPump && <Text style={styles.pumpText}>{PUMP_BEATS[pumpBeat]}！</Text>}
            {!isPump && lastResult === RoundResult.DRAW && <Text style={styles.phaseText}>平局</Text>}
            {!isPump && lastResult === RoundResult.WIN && (
              <Text style={[styles.phaseText, styles.winText]}>这一局你赢了！</Text>
            )}
            {!isPump && lastResult === RoundResult.LOSE && (
              <Text style={[styles.phaseText, styles.loseText]}>这一局你输了</Text>
            )}
            {!isPump && !lastResult && <Text style={styles.phaseText}>结算中...</Text>}
            <Text style={styles.scoreText}>
              {playerScore} : {opponentScore}
            </Text>
          </View>
        );
      }

      case GamePhase.BREAK:
        return (
          <View style={styles.centerContent}>
            <View style={styles.scoreBoard}>
              <Text style={styles.scoreText}>
                {playerScore} : {opponentScore}
              </Text>
            </View>
            <Text style={styles.phaseText}>准备下一轮...</Text>
          </View>
        );

      case GamePhase.FINISHED:
        return (
          <View style={styles.gameOverCard}>
            {/* 整局获胜撒彩带 */}
            {gameResult?.won && !gameResult?.isDraw && <Confetti />}
            <Text style={styles.resultEmoji}>
              {gameResult?.isDraw ? '🤝' : gameResult?.won ? '🎉' : '😢'}
            </Text>
            <Text style={[styles.resultText, !gameResult?.isDraw && (gameResult?.won ? styles.winText : styles.loseText)]}>
              {gameResult?.isDraw ? '平局！' : gameResult?.won ? '你赢了！' : '你输了...'}
            </Text>
            <Text style={styles.finalScore}>
              {playerScore} : {opponentScore}
            </Text>
            {rankDelta !== null && rankDelta !== 0 && (
              <View
                style={[
                  styles.rankDeltaChip,
                  { backgroundColor: rankDelta > 0 ? '#E8F5E9' : '#FFEBEE' },
                ]}
              >
                <Text style={[styles.rankDeltaText, { color: rankDelta > 0 ? '#2E7D32' : '#C62828' }]}>
                  段位分 {rankDelta > 0 ? '+' : ''}
                  {rankDelta}
                </Text>
              </View>
            )}
            <View style={styles.gameOverButtons}>
              {/* 加入私密房间的玩家没有"再来一局"（房间已销毁），返回大厅重新进房 */}
              {!(matchType === 'private' && privateAction === 'join') && (
                <TouchableOpacity
                  style={styles.gameOverButton}
                  onPress={() => {
                    // 私密房间：重置后重新建房（新的邀请码）；在线/AI：重新匹配
                    if (matchType === 'private') privateInitiatedRef.current = false;
                    setGameResult(null);
                    setPhase(GamePhase.WAITING);
                  }}
                >
                  <Text style={styles.gameOverButtonText}>
                    {matchType === 'private' ? '再开一局' : '再来一局'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.gameOverButton, styles.gameOverButtonSecondary]}
                onPress={() => navigation.goBack()}
              >
                <Text style={[styles.gameOverButtonText, styles.gameOverButtonTextSecondary]}>
                  返回
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
    }
  };

  /** 本局已打完的轮次胜负小圆点 */
  const renderRoundHistory = () => {
    if (phase === GamePhase.WAITING || phase === GamePhase.FINISHED) return null;
    if (roundHistory.length === 0) return null;
    return (
      <View style={styles.historyRow}>
        {roundHistory.map((result, idx) => (
          <View
            key={idx}
            style={[
              styles.historyDot,
              {
                backgroundColor:
                  result === RoundResult.WIN
                    ? '#4CAF50'
                    : result === RoundResult.LOSE
                      ? '#E53935'
                      : '#BDBDBD',
              },
            ]}
          />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 顶部渐变信息栏 */}
      <LinearGradient colors={['#6200EE', '#7C4DFF']} style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.topBarRow}>
          <TouchableOpacity onPress={handleQuitPress}>
            <Text style={styles.backButton}>← 退出</Text>
          </TouchableOpacity>
          <Text style={styles.modeText}>第 {roundNumber} 轮</Text>
          <View style={styles.topBarRight} />
        </View>
        <View style={styles.scoreRow}>
          <View style={styles.scoreSide}>
            <Text style={styles.scoreName} numberOfLines={1}>
              {user?.nickname || '我'}
            </Text>
            <Text style={styles.scoreValue}>{playerScore}</Text>
          </View>
          <Text style={styles.versusBig}>:</Text>
          <View style={styles.scoreSide}>
            <Text style={styles.scoreName} numberOfLines={1}>
              {opponentNickname || '对手'}
            </Text>
            <Text style={styles.scoreValue}>{opponentScore}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* 本局轮次历史 */}
      {renderRoundHistory()}

      {/* 突然死亡提示 */}
      {suddenDeath && phase !== GamePhase.WAITING && phase !== GamePhase.FINISHED && (
        <View style={styles.suddenDeathBanner}>
          <Text style={styles.suddenDeathText}>
            🔥 突然死亡 — 下一轮分出胜负者直接赢下整场
          </Text>
        </View>
      )}

      {/* 游戏区域 */}
      <View style={styles.gameArea}>{renderPhase()}</View>

      {/* 对手离线提示条 */}
      {opponentOffline && phase !== GamePhase.FINISHED && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>⚠️ 对手已断线，等待重连（超时将判你获胜）</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  topBar: {
    paddingTop: 44, // 运行时由 insets.top 覆盖
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  topBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backButton: {
    color: '#fff',
    fontSize: 15,
    opacity: 0.9,
  },
  modeText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
  },
  topBarRight: {
    width: 52,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  scoreSide: {
    alignItems: 'center',
    width: 120,
  },
  scoreName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginBottom: 2,
  },
  scoreValue: {
    color: '#fff',
    fontSize: 34,
    fontWeight: 'bold',
  },
  versusBig: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 26,
    fontWeight: 'bold',
    marginHorizontal: 16,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 10,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  suddenDeathBanner: {
    marginTop: 8,
    marginHorizontal: 16,
    backgroundColor: '#FFEBEE',
    borderColor: '#E53935',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  suddenDeathText: {
    color: '#C62828',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  phaseText: {
    color: '#333',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  phaseEmoji: {
    fontSize: 64,
  },
  timerText: {
    color: '#FF9800',
    fontSize: 48,
    fontWeight: 'bold',
    marginTop: 12,
  },
  timerTextSmall: {
    fontSize: 24,
    marginTop: 4,
  },
  timerTextUrgent: {
    color: '#E53935',
  },
  scoreBoard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  scoreText: {
    color: '#333',
    fontSize: 40,
    fontWeight: 'bold',
    marginTop: 8,
  },
  selectingContent: {
    alignItems: 'center',
    padding: 20,
  },
  roundText: {
    color: '#666',
    fontSize: 16,
    marginBottom: 20,
  },
  opponentArea: {
    alignItems: 'center',
    marginBottom: 8,
  },
  playerName: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
  },
  choiceCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  choiceCircleLarge: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  choiceEmoji: {
    fontSize: 40,
  },
  choiceEmojiLarge: {
    fontSize: 48,
  },
  timerBar: {
    width: '80%',
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 12,
    marginTop: 24,
  },
  timerProgress: {
    height: '100%',
    borderRadius: 4,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 20,
  },
  choiceOption: {
    width: 92,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  choiceOptionSelected: {
    borderColor: '#6200EE',
    backgroundColor: '#F3E8FF',
    borderWidth: 3,
  },
  choiceOptionDimmed: {
    opacity: 0.4,
  },
  choiceOptionEmoji: {
    fontSize: 40,
  },
  choiceOptionText: {
    color: '#666',
    fontSize: 14,
    marginTop: 6,
  },
  choiceOptionTextSelected: {
    color: '#6200EE',
    fontWeight: 'bold',
  },
  hintText: {
    color: '#999',
    fontSize: 13,
    marginTop: 16,
  },
  pumpText: {
    color: '#6200EE',
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 16,
  },
  roomCodeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#6200EE',
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 16,
    alignItems: 'center',
    shadowColor: '#6200EE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  roomCodeLabel: {
    color: '#999',
    fontSize: 13,
  },
  roomCodeText: {
    color: '#6200EE',
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 10,
    marginTop: 4,
  },
  settlementNames: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 260,
    marginTop: 8,
  },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginVertical: 8,
  },
  versusText: {
    color: '#999',
    fontSize: 20,
    fontWeight: 'bold',
  },
  winText: {
    color: '#4CAF50',
  },
  loseText: {
    color: '#E53935',
  },
  gameOverCard: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 40,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    minWidth: 300,
  },
  resultEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  resultText: {
    color: '#333',
    fontSize: 28,
    fontWeight: 'bold',
  },
  finalScore: {
    color: '#666',
    fontSize: 24,
    marginTop: 8,
    fontWeight: 'bold',
  },
  rankDeltaChip: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  rankDeltaText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  gameOverButtons: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 28,
  },
  gameOverButton: {
    backgroundColor: '#6200EE',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  gameOverButtonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowOpacity: 0,
    elevation: 0,
  },
  gameOverButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  gameOverButtonTextSecondary: {
    color: '#333',
  },
  offlineBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    backgroundColor: '#FFF3E0',
    borderColor: '#FF9800',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  offlineText: {
    color: '#E65100',
    fontSize: 13,
    textAlign: 'center',
  },
});
