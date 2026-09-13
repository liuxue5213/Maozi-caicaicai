import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameMode, GAME_MODE_LABELS, AI_DIFFICULTY_LABELS, AiDifficulty, getRankTier } from '@maozi/shared';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';

interface HomeScreenProps {
  navigation?: any;
}

export function HomeScreen({ navigation }: HomeScreenProps) {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, stats } = useAuthStore();
  const [onlineCount, setOnlineCount] = useState(0);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  // 私密房间弹窗：'create' 选择模式建房 / 'join' 输入邀请码进房
  const [privateModal, setPrivateModal] = useState<'create' | 'join' | null>(null);
  const [joinCode, setJoinCode] = useState('');

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

  const handleCreatePrivateRoom = (mode: GameMode) => {
    setPrivateModal(null);
    (nav as any).navigate('Game', { mode, matchType: 'private', privateAction: 'create' });
  };

  const handleJoinPrivateRoom = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 3) {
      Alert.alert('提示', '请输入正确的邀请码');
      return;
    }
    setPrivateModal(null);
    setJoinCode('');
    (nav as any).navigate('Game', { mode: GameMode.BEST_OF_3, matchType: 'private', privateAction: 'join', roomCode: code });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.welcome}>你好，{user?.nickname || '玩家'} 👋</Text>
        <Text style={styles.onlineCount}>在线人数: {onlineCount}</Text>
      </View>

      {/* 玩家信息卡片 */}
      <View style={styles.statsCard}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>我的战绩</Text>
          {stats && (
            <Text style={[styles.tierBadge, { color: getRankTier(stats.rank).color }]}>
              {getRankTier(stats.rank).emoji} {getRankTier(stats.rank).name} · {stats.rank}分
            </Text>
          )}
        </View>
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

      {/* 私密房间（邀请码对战） */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔒 私密房间</Text>
        <Text style={styles.sectionDesc}>创建房间把邀请码发给好友，1 对 1 私下对决</Text>
        <View style={styles.modeGrid}>
          <TouchableOpacity
            style={styles.modeButtonPrivate}
            onPress={() => setPrivateModal('create')}
          >
            <Text style={styles.modeButtonText}>创建房间</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.modeButtonPrivateSecondary}
            onPress={() => setPrivateModal('join')}
          >
            <Text style={styles.modeButtonPrivateSecondaryText}>输入邀请码加入</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 私密房间弹窗 */}
      <Modal
        visible={privateModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPrivateModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {privateModal === 'create' ? (
              <>
                <Text style={styles.modalTitle}>选择对局模式</Text>
                <Text style={styles.modalDesc}>创建后把邀请码发给好友即可开局</Text>
                <View style={styles.modalModeGrid}>
                  {Object.entries(GAME_MODE_LABELS).map(([mode, label]) => (
                    <TouchableOpacity
                      key={mode}
                      style={styles.modalModeButton}
                      onPress={() => handleCreatePrivateRoom(Number(mode) as GameMode)}
                    >
                      <Text style={styles.modalModeButtonText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>输入邀请码</Text>
                <Text style={styles.modalDesc}>向房主要一个 4 位邀请码</Text>
                <TextInput
                  style={styles.codeInput}
                  value={joinCode}
                  onChangeText={(text) => setJoinCode(text.toUpperCase())}
                  placeholder="如：A7XK"
                  placeholderTextColor="#bbb"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={4}
                  autoFocus
                />
                <TouchableOpacity style={styles.modeButtonPrivate} onPress={handleJoinPrivateRoom}>
                  <Text style={styles.modeButtonText}>加入房间</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setPrivateModal(null)}>
              <Text style={styles.modalCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingTop: 60, // 运行时由 insets.top 覆盖
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
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tierBadge: {
    fontSize: 13,
    fontWeight: 'bold',
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
  modeButtonPrivate: {
    backgroundColor: '#FF7043',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: '47%',
    alignItems: 'center',
  },
  modeButtonPrivateSecondary: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#FF7043',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: '47%',
    alignItems: 'center',
  },
  modeButtonPrivateSecondaryText: {
    color: '#FF7043',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  modalDesc: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  modalModeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modalModeButton: {
    backgroundColor: '#F3E8FF',
    borderWidth: 2,
    borderColor: '#6200EE',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: '47%',
    alignItems: 'center',
    flexGrow: 1,
  },
  modalModeButtonText: {
    color: '#6200EE',
    fontSize: 15,
    fontWeight: 'bold',
  },
  codeInput: {
    borderWidth: 2,
    borderColor: '#6200EE',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 8,
    textAlign: 'center',
    color: '#333',
    marginBottom: 16,
  },
  modalCancel: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  modalCancelText: {
    color: '#999',
    fontSize: 15,
  },
});
