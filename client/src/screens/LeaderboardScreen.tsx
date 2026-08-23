import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { api } from '../api/client';

interface LeaderboardEntry {
  rank: number;
  user: {
    id: string;
    username: string;
    nickname: string;
    avatar: string | null;
  };
  stats: {
    totalGames: number;
    wins: number;
    losses: number;
    bestWinStreak: number;
    rank: number;
  };
}

export function LeaderboardScreen() {
  const [type, setType] = useState<'wins' | 'streak'>('wins');
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.getLeaderboard(type, 100);
      setData(result as LeaderboardEntry[]);
    } catch (error) {
      console.error('获取排行榜失败:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [type]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [type, fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isTop3 = item.rank <= 3;
    const rankEmoji = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : '';

    return (
      <View style={[styles.item, isTop3 && styles.itemTop3]}>
        <View style={styles.rankContainer}>
          {isTop3 ? (
            <Text style={styles.rankEmoji}>{rankEmoji}</Text>
          ) : (
            <Text style={styles.rankText}>{item.rank}</Text>
          )}
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.nickname}>{item.user.nickname}</Text>
          <Text style={styles.detailText}>
            胜率: {item.stats.totalGames > 0
              ? Math.round((item.stats.wins / item.stats.totalGames) * 100)
              : 0}%
            {' · '}场次: {item.stats.totalGames}
          </Text>
        </View>
        <View style={styles.statContainer}>
          {type === 'wins' ? (
            <Text style={styles.statValue}>{item.stats.wins}胜</Text>
          ) : (
            <Text style={styles.statValue}>{item.stats.bestWinStreak}连胜</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 类型切换 */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, type === 'wins' && styles.tabActive]}
          onPress={() => setType('wins')}
        >
          <Text style={[styles.tabText, type === 'wins' && styles.tabTextActive]}>
            胜场榜
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, type === 'streak' && styles.tabActive]}
          onPress={() => setType('streak')}
        >
          <Text style={[styles.tabText, type === 'streak' && styles.tabTextActive]}>
            连胜榜
          </Text>
        </TouchableOpacity>
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6200EE" />
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.user.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
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
  tabContainer: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 60,
    gap: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  tabActive: {
    backgroundColor: '#6200EE',
    borderColor: '#6200EE',
  },
  tabText: {
    color: '#666',
    fontSize: 16,
    fontWeight: 'bold',
  },
  tabTextActive: {
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  itemTop3: {
    borderColor: '#FFD700',
    borderWidth: 2,
  },
  rankContainer: {
    width: 48,
    alignItems: 'center',
  },
  rankEmoji: {
    fontSize: 24,
  },
  rankText: {
    color: '#666',
    fontSize: 18,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  nickname: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
  detailText: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  statContainer: {
    alignItems: 'flex-end',
  },
  statValue: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
