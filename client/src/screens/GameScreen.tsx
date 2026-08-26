import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { GameChoice, GameMode, GamePhase } from '@maozi/shared';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuthStore } from '../store/authStore';

interface GameParams {
  mode: GameMode;
  matchType: 'online' | 'ai';
}

export function GameScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { mode, matchType } = (route.params || { mode: GameMode.BEST_OF_3, matchType: 'online' }) as GameParams;

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
  const [selectedDisplay, setSelectedDisplay] = useState<GameChoice>(GameChoice.ROCK);
  const [isMatching, setIsMatching] = useState(false);
  const [opponentNickname, setOpponentNickname] = useState<string>('');
  const [gameResult, setGameResult] = useState<{ won: boolean; isDraw: boolean } | null>(null);

  // 定时器 refs
  const switchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const choiceLockedRef = useRef(false);

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
    if (payload.opponent) {
      setOpponentNickname(payload.opponent.nickname || '对手');
    }
  }, []);

  const handlePhaseUpdate = useCallback((payload: any) => {
    setPhase(payload.phase);
    setRoundNumber(payload.roundNumber);
    setTimeRemaining(payload.timeRemaining);
    setLocalEndTime(Date.now() + payload.timeRemaining); // 设置本地倒计时
    setPlayerScore(payload.playerScore);
    setOpponentScore(payload.opponentScore);

    // 进入选择阶段
    if (payload.phase === GamePhase.SELECTING) {
      setPlayerChoice(null);
      setOpponentChoice(null);
      choiceLockedRef.current = false;
      startChoiceSwitching();
    } else {
      stopChoiceSwitching();
    }
  }, []);

  const handleRoundResult = useCallback((payload: any) => {
    stopChoiceSwitching();
    setPlayerChoice(payload.playerChoice);
    setOpponentChoice(payload.opponentChoice);
    setPlayerScore(payload.playerScore);
    setOpponentScore(payload.opponentScore);
  }, []);

  const handleGameOver = useCallback((payload: any) => {
    stopChoiceSwitching();
    setPhase(GamePhase.FINISHED);
    setPlayerScore(payload.finalScore?.player ?? 0);
    setOpponentScore(payload.finalScore?.opponent ?? 0);
    setGameResult({ won: payload.playerWon, isDraw: Boolean(payload.isDraw) });
    if (payload.stats) {
      setStats(payload.stats);
    }
  }, [setStats]);

  const handleMatching = useCallback(() => {
    setIsMatching(true);
  }, []);

  const handleMatchTimeout = useCallback(() => {
    setIsMatching(false);
    Alert.alert('匹配超时', '暂时没有匹配到对手，请重试', [
      { text: '确定', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  // WebSocket 钩子
  const ws = useWebSocket({
    onGameStart: handleGameStart,
    onPhaseUpdate: handlePhaseUpdate,
    onRoundResult: handleRoundResult,
    onGameOver: handleGameOver,
    onMatching: handleMatching,
    onMatchTimeout: handleMatchTimeout,
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

  // 连接 WebSocket
  useEffect(() => {
    ws.connect();
    return () => ws.disconnect();
  }, []);

  // 修复: 等待认证通过后再开始匹配
  useEffect(() => {
    if (
      ws.isConnected &&
      ws.isAuthenticated &&
      !isMatching &&
      phase === GamePhase.WAITING &&
      !gameResult
    ) {
      if (matchType === 'ai') {
        ws.startAiMatch(mode);
      } else {
        ws.startMatching(mode);
      }
    }
  }, [ws.isConnected, ws.isAuthenticated, isMatching, phase, gameResult, matchType, mode]);

  // 选择切换（10秒内循环切换）
  const startChoiceSwitching = () => {
    stopChoiceSwitching();
    let idx = 0;
    switchIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % 3;
      setSelectedDisplay([GameChoice.ROCK, GameChoice.SCISSORS, GameChoice.PAPER][idx]);
    }, 500);
  };

  const stopChoiceSwitching = () => {
    if (switchIntervalRef.current) {
      clearInterval(switchIntervalRef.current);
      switchIntervalRef.current = null;
    }
  };

  // 确认选择
  const confirmChoice = () => {
    if (choiceLockedRef.current || phase !== GamePhase.SELECTING) return;
    choiceLockedRef.current = true;
    stopChoiceSwitching();
    setPlayerChoice(selectedDisplay);
    ws.makeChoice(selectedDisplay);
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

  // 渲染不同阶段
  const renderPhase = () => {
    switch (phase) {
      case GamePhase.WAITING:
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#6200EE" />
            <Text style={styles.phaseText}>正在连接服务器...</Text>
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
            <Text style={styles.roundText}>第 {roundNumber} 轮</Text>
            
            {/* 对手选择 */}
            <View style={styles.opponentArea}>
              <Text style={styles.playerName}>{opponentNickname || '对手'}</Text>
              <View style={styles.choiceCircle}>
                <Text style={styles.choiceEmoji}>
                  {opponentChoice ? getChoiceEmoji(opponentChoice) : '❓'}
                </Text>
              </View>
            </View>

            {/* 倒计时进度条 */}
            <View style={styles.timerBar}>
              <View
                style={[
                  styles.timerProgress,
                  { width: `${(timeRemaining / 10000) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.timerText}>{Math.ceil(timeRemaining / 1000)}s</Text>

            {/* 玩家选择 */}
            <View style={styles.playerArea}>
              <Text style={styles.playerName}>{user?.nickname || '我'}</Text>
              <View style={[styles.choiceCircle, styles.playerChoiceCircle]}>
                <Text style={styles.choiceEmoji}>{getChoiceEmoji(selectedDisplay)}</Text>
              </View>
              <Text style={styles.choiceLabel}>{getChoiceText(selectedDisplay)}</Text>
            </View>

            {/* 确认按钮 */}
            <TouchableOpacity
              style={[styles.confirmButton, playerChoice && styles.confirmButtonDisabled]}
              onPress={confirmChoice}
              disabled={!!playerChoice}
            >
              <Text style={styles.confirmButtonText}>
                {playerChoice ? '已选择' : '确认选择'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      case GamePhase.SETTLEMENT:
        return (
          <View style={styles.centerContent}>
            <Text style={styles.phaseText}>结算中...</Text>
          </View>
        );

      case GamePhase.BREAK:
        return (
          <View style={styles.centerContent}>
            <View style={styles.scoreBoard}>
              <Text style={styles.scoreText}>{playerScore} : {opponentScore}</Text>
            </View>
            <Text style={styles.phaseText}>准备下一轮...</Text>
          </View>
        );

      case GamePhase.FINISHED:
        return (
          <View style={styles.gameOverContent}>
            <Text style={styles.resultEmoji}>
              {gameResult?.isDraw ? '🤝' : gameResult?.won ? '🎉' : '😢'}
            </Text>
            <Text style={styles.resultText}>
              {gameResult?.isDraw ? '平局！' : gameResult?.won ? '你赢了！' : '你输了...'}
            </Text>
            <Text style={styles.finalScore}>
              {playerScore} : {opponentScore}
            </Text>
            <View style={styles.gameOverButtons}>
              <TouchableOpacity
                style={styles.gameOverButton}
                onPress={() => {
                  setGameResult(null);
                  setPhase(GamePhase.WAITING);
                  if (matchType === 'ai') {
                    ws.startAiMatch(mode);
                  } else {
                    ws.startMatching(mode);
                  }
                }}
              >
                <Text style={styles.gameOverButtonText}>再来一局</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.gameOverButton, styles.gameOverButtonSecondary]}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.gameOverButtonText}>返回</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      {/* 顶部信息栏 */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← 退出</Text>
        </TouchableOpacity>
        <Text style={styles.scoreDisplay}>
          {playerScore} - {opponentScore}
        </Text>
        <View style={styles.topBarRight} />
      </View>

      {/* 游戏区域 */}
      <View style={styles.gameArea}>
        {renderPhase()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
  },
  backButton: {
    color: '#333',
    fontSize: 16,
  },
  scoreDisplay: {
    color: '#333',
    fontSize: 20,
    fontWeight: 'bold',
  },
  topBarRight: {
    width: 60,
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
    fontSize: 48,
    fontWeight: 'bold',
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
    marginBottom: 30,
  },
  playerArea: {
    alignItems: 'center',
    marginTop: 30,
  },
  playerName: {
    color: '#666',
    fontSize: 14,
    marginBottom: 8,
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
  playerChoiceCircle: {
    borderColor: '#6200EE',
    borderWidth: 3,
  },
  choiceEmoji: {
    fontSize: 40,
  },
  choiceLabel: {
    color: '#333',
    fontSize: 14,
    marginTop: 8,
  },
  timerBar: {
    width: '80%',
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 16,
  },
  timerProgress: {
    height: '100%',
    backgroundColor: '#FF9800',
  },
  confirmButton: {
    backgroundColor: '#6200EE',
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  gameOverContent: {
    alignItems: 'center',
    padding: 20,
  },
  resultEmoji: {
    fontSize: 64,
    marginBottom: 16,
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
  },
  gameOverButtons: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 32,
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
  },
  gameOverButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
