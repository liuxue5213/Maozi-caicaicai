import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { GameMode, GAME_MODE_LABELS, AI_DIFFICULTY_LABELS, AiDifficulty } from '@maozi/shared';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';

interface HomeScreenProps {
  navigation?: any;
}

export function HomeScreen({ navigation }: HomeScreenProps) {
  const nav = useNavigation();
  const { user, stats } = useAuthStore();
  const [onlineCount, setOnlineCount] = useState(0);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');

  useEffect(() => {
    fetchOnlineCount();
    const interval = setInterval(fetchOnlineCount, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchOnlineCount = async () => {
    try {
      const { count } = await api.getOnlineCount();
      setOnlineCount(count);
    } catch {
      // ignore
    }
  };

  const handleStartGame = (mode: GameMode) => {
    (nav as any).navigate('Game', { mode, matchType: 'online' });
  };

  const handleStartAiGame = (mode: GameMode) => {
    (nav as any).navigate('Game', { mode, matchType: 'ai', difficulty });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcome}>你好，{user?.nickname || '玩家'} 👋</Text>
        <Text style={styles.onlineCount}>在线人数: {onlineCount}</Text>
      </View>

      {/* 玩家信息卡片 */}
      <View style={styles.statsCard}>
        <Text style={styles.cardTitle}>我的战绩</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.totalGames || 0}</Text>
            <Text style={styles.statLabel}>总场次</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.wins || 0}</Text>
            <Text style={styles.statLabel}>胜场</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {stats?.totalGames
                ? Math.round((stats.wins / stats.totalGames) * 100)
                : 0}%
            </Text>
            <Text style={styles.statLabel}>胜率</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.bestWinStreak || 0}</Text>
            <Text style={styles.statLabel}>最高连胜</Text>
          </View>
        </View>
      </View>

      {/* 联网对战 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚡ 联网对战</Text>
        <Text style={styles.sectionDesc}>与真实玩家实时匹配对战</Text>
        <View style={styles.modeGrid}>
          {Object.entries(GAME_MODE_LABELS).map(([mode, label]) => (
            <TouchableOpacity
              key={mode}
              style={styles.modeButtonOnline}
              onPress={() => handleStartGame(Number(mode) as GameMode)}
            >
              <Text style={styles.modeButtonText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 人机对战 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🤖 人机对战</Text>
        <Text style={styles.sectionDesc}>与 AI 练习技巧</Text>
        <View style={styles.difficultyRow}>
          {(Object.keys(AI_DIFFICULTY_LABELS) as AiDifficulty[]).map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.difficultyButton, difficulty === d && styles.difficultyButtonActive]}
              onPress={() => setDifficulty(d)}
            >
              <Text
                style={[
                  styles.difficultyButtonText,
                  difficulty === d && styles.difficultyButtonTextActive,
                ]}
              >
                {AI_DIFFICULTY_LABELS[d]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.modeGrid}>
          {[GameMode.BEST_OF_3, GameMode.BEST_OF_5].map((mode) => (
            <TouchableOpacity
              key={mode}
              style={styles.modeButtonAi}
              onPress={() => handleStartAiGame(mode)}
            >
              <Text style={styles.modeButtonText}>{GAME_MODE_LABELS[mode]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    paddingTop: 60,
  },
  welcome: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  onlineCount: {
    fontSize: 14,
    color: '#4CAF50',
    marginTop: 4,
  },
  statsCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  difficultyButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  difficultyButtonActive: {
    backgroundColor: '#03DAC6',
    borderColor: '#03DAC6',
  },
  difficultyButtonText: {
    color: '#666',
    fontSize: 14,
  },
  difficultyButtonTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  modeButtonOnline: {
    backgroundColor: '#6200EE',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: '47%',
    alignItems: 'center',
  },
  modeButtonAi: {
    backgroundColor: '#03DAC6',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: '47%',
    alignItems: 'center',
  },
  modeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
