import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Switch,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { GAME_MODE_LABELS, getRankTier } from '@maozi/shared';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';
import { getGameCountTitle, getWinStreakTitle } from '../utils/titles';
import { isSoundMuted, setSoundMuted } from '../utils/sounds';

interface HistoryItem {
  id: string;
  timestamp: number;
  mode: number;
  isAi: boolean;
  opponentNickname: string;
  myScore: number;
  opponentScore: number;
  isDraw: boolean;
  won: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProfileScreen() {
  const { user, stats, logout, updateNickname } = useAuthStore();
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(user?.nickname || '');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [soundOn, setSoundOn] = useState(!isSoundMuted());

  // 每次切到"我的"页时刷新历史
  useFocusEffect(
    useCallback(() => {
      api
        .getHistory(20)
        .then(setHistory)
        .catch(() => {});
    }, [])
  );

  const handleToggleSound = async (value: boolean) => {
    setSoundOn(value);
    await setSoundMuted(!value);
  };

  const handleSaveNickname = async () => {
    if (!newNickname.trim()) return;
    try {
      await api.updateNickname(newNickname.trim());
      updateNickname(newNickname.trim());
      setEditingNickname(false);
    } catch (error: any) {
      Alert.alert('错误', error.message);
    }
  };

  const handleLogout = () => {
    Alert.alert('确认', '确定要退出登录吗？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: logout },
    ]);
  };

  const gameCountTitle = stats ? getGameCountTitle(stats.totalGames) : null;
  const winStreakTitle = stats ? getWinStreakTitle(stats.currentWinStreak) : null;

  return (
    <ScrollView style={styles.container}>
      {/* 用户信息卡片 */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.nickname?.[0] || '?'}
          </Text>
        </View>

        {editingNickname ? (
          <View style={styles.editContainer}>
            <TextInput
              style={styles.nicknameInput}
              value={newNickname}
              onChangeText={setNewNickname}
              maxLength={20}
              autoFocus
            />
            <View style={styles.editButtons}>
              <TouchableOpacity onPress={() => setEditingNickname(false)}>
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveNickname}>
                <Text style={styles.saveText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditingNickname(true)}>
            <Text style={styles.nickname}>{user?.nickname}</Text>
            <Text style={styles.editHint}>点击修改昵称</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 称号展示 */}
      {gameCountTitle && (
        <View style={styles.titleCard}>
          <Text style={styles.titleLabel}>当前称号</Text>
          <Text style={[styles.titleName, { color: gameCountTitle.color }]}>
            {gameCountTitle.name}
          </Text>
          <Text style={styles.titleDesc}>{gameCountTitle.description}</Text>
          {winStreakTitle && (
            <Text style={[styles.titleName, { color: winStreakTitle.color, marginTop: 8 }]}>
              {winStreakTitle.name}
            </Text>
          )}
        </View>
      )}

      {/* 战绩统计 */}
      <View style={styles.statsCard}>
        <Text style={styles.sectionTitle}>详细战绩</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats?.totalGames || 0}</Text>
            <Text style={styles.statName}>总场次</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.winNumber]}>{stats?.wins || 0}</Text>
            <Text style={styles.statName}>胜场</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.loseNumber]}>{stats?.losses || 0}</Text>
            <Text style={styles.statName}>负场</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.drawNumber]}>{stats?.draws || 0}</Text>
            <Text style={styles.statName}>平局</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {stats?.totalGames
                ? Math.round((stats.wins / stats.totalGames) * 100)
                : 0}%
            </Text>
            <Text style={styles.statName}>胜率</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats?.bestWinStreak || 0}</Text>
            <Text style={styles.statName}>最高连胜</Text>
          </View>
        </View>
      </View>

      {/* 段位 */}
      <View style={styles.rankCard}>
        <Text style={styles.sectionTitle}>我的段位</Text>
        {stats && (
          <>
            <Text style={[styles.tierEmoji, { color: getRankTier(stats.rank).color }]}>
              {getRankTier(stats.rank).emoji}
            </Text>
            <Text style={[styles.tierName, { color: getRankTier(stats.rank).color }]}>
              {getRankTier(stats.rank).name}
            </Text>
            <Text style={styles.rankScore}>{stats.rank} 分</Text>
          </>
        )}
      </View>

      {/* 最近对局 */}
      <View style={styles.historyCard}>
        <Text style={styles.sectionTitle}>最近对局</Text>
        {history.length === 0 ? (
          <Text style={styles.historyEmpty}>还没有对局记录，快去打一局吧！</Text>
        ) : (
          history.map((item) => (
            <View key={item.id} style={styles.historyItem}>
              <View
                style={[
                  styles.resultBadge,
                  {
                    backgroundColor: item.isDraw
                      ? '#FFF3E0'
                      : item.won
                        ? '#E8F5E9'
                        : '#FFEBEE',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.resultBadgeText,
                    {
                      color: item.isDraw ? '#E65100' : item.won ? '#2E7D32' : '#C62828',
                    },
                  ]}
                >
                  {item.isDraw ? '平' : item.won ? '胜' : '负'}
                </Text>
              </View>
              <View style={styles.historyInfo}>
                <Text style={styles.historyOpponent} numberOfLines={1}>
                  vs {item.opponentNickname}
                  {item.isAi ? '（AI）' : ''}
                </Text>
                <Text style={styles.historyMeta}>
                  {GAME_MODE_LABELS[item.mode as keyof typeof GAME_MODE_LABELS] ?? '对局'} ·{' '}
                  {formatTime(item.timestamp)}
                </Text>
              </View>
              <Text
                style={[
                  styles.historyScore,
                  { color: item.isDraw ? '#FF9800' : item.won ? '#4CAF50' : '#E53935' },
                ]}
              >
                {item.myScore} : {item.opponentScore}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* 设置 */}
      <View style={styles.settingCard}>
        <Text style={styles.sectionTitle}>设置</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>🔊 对局音效</Text>
          <Switch value={soundOn} onValueChange={handleToggleSound} />
        </View>
      </View>

      {/* 退出登录 */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>退出登录</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  profileCard: {
    alignItems: 'center',
    padding: 24,
    paddingTop: 60,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6200EE',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  nickname: {
    color: '#333',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 12,
  },
  editHint: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  editContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  nicknameInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    color: '#333',
    fontSize: 18,
    borderWidth: 1,
    borderColor: '#6200EE',
    minWidth: 200,
    textAlign: 'center',
  },
  editButtons: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 8,
  },
  cancelText: {
    color: '#666',
    fontSize: 14,
  },
  saveText: {
    color: '#6200EE',
    fontSize: 14,
    fontWeight: 'bold',
  },
  titleCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  titleLabel: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  titleName: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  titleDesc: {
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
  statsCard: {
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 0,
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
  sectionTitle: {
    color: '#666',
    fontSize: 14,
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statBox: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  statNumber: {
    color: '#333',
    fontSize: 20,
    fontWeight: 'bold',
  },
  winNumber: {
    color: '#4CAF50',
  },
  loseNumber: {
    color: '#E53935',
  },
  drawNumber: {
    color: '#FF9800',
  },
  statName: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  rankCard: {
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 0,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tierEmoji: {
    fontSize: 40,
  },
  tierName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 4,
  },
  rankScore: {
    color: '#999',
    fontSize: 16,
    marginTop: 4,
  },
  historyCard: {
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 0,
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
  historyEmpty: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  resultBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyInfo: {
    flex: 1,
    marginLeft: 12,
  },
  historyOpponent: {
    color: '#333',
    fontSize: 15,
    fontWeight: 'bold',
  },
  historyMeta: {
    color: '#999',
    fontSize: 12,
    marginTop: 2,
  },
  historyScore: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  settingCard: {
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 0,
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
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingLabel: {
    color: '#333',
    fontSize: 15,
  },
  logoutButton: {
    margin: 16,
    marginTop: 0,
    backgroundColor: '#E53935',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
