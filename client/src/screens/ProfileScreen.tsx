import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';
import { getGameCountTitle, getWinStreakTitle } from '../utils/titles';

export function ProfileScreen() {
  const { user, stats, logout, updateNickname } = useAuthStore();
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(user?.nickname || '');

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
        <Text style={styles.sectionTitle}>段位分</Text>
        <Text style={styles.rankScore}>{stats?.rank || 1000}</Text>
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
    backgroundColor: '#1a1a2e',
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
  },
  avatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  nickname: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 12,
  },
  editHint: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 4,
  },
  editContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  nicknameInput: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
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
    color: '#aaa',
    fontSize: 14,
  },
  saveText: {
    color: '#6200EE',
    fontSize: 14,
    fontWeight: 'bold',
  },
  titleCard: {
    backgroundColor: '#16213e',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  titleLabel: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 8,
  },
  titleName: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  titleDesc: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 4,
  },
  statsCard: {
    backgroundColor: '#16213e',
    margin: 16,
    marginTop: 0,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  sectionTitle: {
    color: '#aaa',
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
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statNumber: {
    color: '#fff',
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
    color: '#FFA726',
  },
  statName: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 4,
  },
  rankCard: {
    backgroundColor: '#16213e',
    margin: 16,
    marginTop: 0,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  rankScore: {
    color: '#FFD700',
    fontSize: 36,
    fontWeight: 'bold',
  },
  logoutButton: {
    margin: 16,
    marginTop: 0,
    backgroundColor: '#E53935',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
