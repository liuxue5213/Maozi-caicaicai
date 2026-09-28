import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { GameMode, getRankTier, FriendInfo } from '@maozi/shared';
import { api } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTheme } from '../theme';

/**
 * 好友页：添加/删除好友、查看在线状态、一键约战。
 * 本页保持一条 WebSocket 长连接用于接收约战邀请——
 * Tab 常驻不卸载，应用在前台期间邀请随时可达。
 */
export function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const t = useTheme();
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inputName, setInputName] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchFriends = useCallback(async () => {
    try {
      setFriends((await api.getFriends()) as FriendInfo[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFriends();
    // 在线状态轮询
    const timer = setInterval(fetchFriends, 30000);
    return () => clearInterval(timer);
  }, [fetchFriends]);

  /** 对方接受后：对局绑定在本页连接上，进入对局页后由重连机制自动接管 */
  const acceptChallenge = useCallback(
    (payload: any) => {
      ws.challengeResponse(payload.challengeId, true);
      nav.navigate('Game', { mode: payload.mode || GameMode.BEST_OF_3, matchType: 'friend-game' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nav]
  );

  const handleChallengeReceived = useCallback(
    (payload: any) => {
      const from = payload?.from || {};
      Alert.alert(
        '⚔️ 好友约战',
        `${from.nickname || '好友'} 邀你来一局三局两胜，接受吗？`,
        [
          { text: '拒绝', style: 'cancel', onPress: () => ws.challengeResponse(payload.challengeId, false) },
          { text: '接受', onPress: () => acceptChallenge(payload) },
        ],
        { cancelable: false }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acceptChallenge]
  );

  const handleChallengeDeclined = useCallback((payload: any) => {
    const reasonMap: Record<string, string> = {
      declined: '对方婉拒了你的约战',
      timeout: '对方没有响应，约战已超时',
      unavailable: '对方当前不在线或正在对局中',
    };
    const msg = reasonMap[payload?.reason] || '约战未成局';
    // 约战未成局时若还停在对局等待页，退回好友页
    Alert.alert('约战未成局', msg, [{ text: '知道了', onPress: () => nav.goBack?.() }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  const ws = useWebSocket({
    onChallengeReceived: handleChallengeReceived,
    onChallengeDeclined: handleChallengeDeclined,
    onError: (error) => {
      if (/约战/.test(error)) Alert.alert('约战失败', error);
    },
  });

  // 本页长连接：接收约战邀请（断线自动重连）
  useEffect(() => {
    ws.connect();
    return () => ws.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    const username = inputName.trim();
    if (!username || adding) return;
    setAdding(true);
    try {
      const friend = await api.addFriend(username);
      setFriends((prev) => (prev.some((f) => f.id === friend.id) ? prev : [...prev, friend as FriendInfo]));
      setInputName('');
    } catch (error: any) {
      Alert.alert('添加失败', error.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = (friend: FriendInfo) => {
    Alert.alert('删除好友', `确定删除 ${friend.nickname} 吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeFriend(friend.id);
            setFriends((prev) => prev.filter((f) => f.id !== friend.id));
          } catch {
            // ignore
          }
        },
      },
    ]);
  };

  const handleChallenge = (friend: FriendInfo) => {
    nav.navigate('Game', { mode: GameMode.BEST_OF_3, matchType: 'challenge', targetId: friend.id });
  };

  const renderItem = ({ item }: { item: FriendInfo }) => {
    const tier = getRankTier(item.rank);
    return (
      <View style={[styles.item, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={styles.itemAvatar}>{item.avatar || '🙂'}</Text>
        <View style={styles.itemInfo}>
          <View style={styles.itemNameRow}>
            <Text style={[styles.itemNickname, { color: t.text }]}>{item.nickname}</Text>
            <View style={[styles.onlineDot, item.online ? styles.onlineOn : styles.onlineOff]} />
            <Text style={[styles.onlineText, { color: item.online ? t.success : t.textMuted }]}>
              {item.online ? '在线' : '离线'}
            </Text>
          </View>
          <Text style={[styles.itemTier, { color: tier.color }]}>
            {tier.emoji} {tier.name} · {item.rank}分
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.challengeButton, { backgroundColor: '#FF7043' }, !item.online && styles.challengeButtonDisabled]}
          disabled={!item.online}
          onPress={() => handleChallenge(item)}
        >
          <Text style={styles.challengeButtonText}>约战</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.removeButton} onPress={() => handleRemove(item)}>
          <Text style={[styles.removeButtonText, { color: t.textMuted }]}>删除</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.headerTitle, { color: t.text }]}>👥 好友</Text>
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
            value={inputName}
            onChangeText={setInputName}
            placeholder="输入好友的注册用户名"
            placeholderTextColor={t.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          <TouchableOpacity style={[styles.addButton, { backgroundColor: t.primary }]} onPress={handleAdd} disabled={adding}>
            <Text style={[styles.addButtonText, { color: t.onGradient }]}>{adding ? '...' : '添加'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>👋</Text>
          <Text style={[styles.emptyText, { color: t.text }]}>还没有好友</Text>
          <Text style={[styles.emptyHint, { color: t.textMuted }]}>输入对方的注册用户名添加，添加后可以随时约战</Text>
        </View>
      ) : (
        <FlatList
          data={friends}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchFriends(); }} tintColor={t.primary} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#333',
  },
  addButton: {
    backgroundColor: '#6200EE',
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 12,
  },
  emptyText: {
    color: '#333',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyHint: {
    color: '#999',
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  itemAvatar: {
    fontSize: 30,
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemNickname: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineOn: {
    backgroundColor: '#4CAF50',
  },
  onlineOff: {
    backgroundColor: '#ccc',
  },
  onlineText: {
    fontSize: 12,
  },
  itemTier: {
    fontSize: 12,
    marginTop: 3,
    fontWeight: 'bold',
  },
  challengeButton: {
    backgroundColor: '#FF7043',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  challengeButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  challengeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  removeButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  removeButtonText: {
    color: '#999',
    fontSize: 13,
  },
});
