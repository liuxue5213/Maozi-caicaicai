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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRankTier, MyRankInfo } from '@maozi/shared';
import { api } from '../api/client';
import { useTheme } from '../theme';

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
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const [type, setType] = useState<'wins' | 'streak' | 'rank'>('wins');
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myRank, setMyRank] = useState<MyRankInfo | null>(null);

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

  const fetchMyRank = useCallback(async () => {
    try {
      const result = await api.getMyRank(type);
      setMyRank(result);
    } catch {
      // 未登录或接口失败时不显示我的名次栏
      setMyRank(null);
    }
  }, [type]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    fetchMyRank();
  }, [type, fetchData, fetchMyRank]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
    fetchMyRank();
  };

  /** 榜单项右侧的数值展示（榜单与“我的名次”栏共用） */
  const renderStat = (stats: LeaderboardEntry['stats']) => {
    if (type === 'wins') {
      return <Text style={[styles.statValue, { color: t.success }]}>{stats.wins}胜</Text>;
    }
    if (type === 'streak') {
      return <Text style={[styles.statValue, { color: t.success }]}>{stats.bestWinStreak}连胜</Text>;
    }
    return (
      <View style={styles.rankStat}>
        <Text style={[styles.tierText, { color: getRankTier(stats.rank).color }]}>
          {getRankTier(stats.rank).emoji} {getRankTier(stats.rank).name}
        </Text>
        <Text style={[styles.rankScore, { color: t.textMuted }]}>{stats.rank}分</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isTop3 = item.rank <= 3;
    const rankEmoji = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : '';

    return (
      <View style={[styles.item, { backgroundColor: t.card, borderColor: t.border }, isTop3 && styles.itemTop3]}>
        <View style={styles.rankContainer}>
          {isTop3 ? (
            <Text style={styles.rankEmoji}>{rankEmoji}</Text>
          ) : (
            <Text style={[styles.rankText, { color: t.textSecondary }]}>{item.rank}</Text>
          )}
        </View>
        <Text style={styles.itemAvatar}>{item.user.avatar || '🙂'}</Text>
        <View style={styles.userInfo}>
          <Text style={[styles.nickname, { color: t.text }]}>{item.user.nickname}</Text>
          <Text style={[styles.detailText, { color: t.textSecondary }]}>
            胜率: {item.stats.totalGames > 0
              ? Math.round((item.stats.wins / item.stats.totalGames) * 100)
              : 0}%
            {' · '}场次: {item.stats.totalGames}
          </Text>
        </View>
        <View style={styles.statContainer}>{renderStat(item.stats)}</View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      {/* 类型切换 */}
      <View style={[styles.tabContainer, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            { backgroundColor: t.card, borderColor: t.border },
            type === 'wins' && { backgroundColor: t.primary, borderColor: t.primary },
          ]}
          onPress={() => setType('wins')}
        >
          <Text style={[styles.tabText, { color: t.textSecondary }, type === 'wins' && { color: t.onGradient }]}>
            胜场榜
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            { backgroundColor: t.card, borderColor: t.border },
            type === 'streak' && { backgroundColor: t.primary, borderColor: t.primary },
          ]}
          onPress={() => setType('streak')}
        >
          <Text style={[styles.tabText, { color: t.textSecondary }, type === 'streak' && { color: t.onGradient }]}>
            连胜榜
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            { backgroundColor: t.card, borderColor: t.border },
            type === 'rank' && { backgroundColor: t.primary, borderColor: t.primary },
          ]}
          onPress={() => setType('rank')}
        >
          <Text style={[styles.tabText, { color: t.textSecondary }, type === 'rank' && { color: t.onGradient }]}>
            段位榜
          </Text>
        </TouchableOpacity>
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>🏆</Text>
          <Text style={[styles.emptyText, { color: t.text }]}>榜单还是空的</Text>
          <Text style={[styles.emptyHint, { color: t.textMuted }]}>打完第一局，这里就会出现你的名字</Text>
        </View>
      ) : (
        <View style={styles.listWrapper}>
          <FlatList
            data={data}
            renderItem={renderItem}
            keyExtractor={(item) => item.user.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />
            }
            contentContainerStyle={styles.listContent}
          />

          {/* 我的名次：排在榜单之外也能看到自己 */}
          {myRank && (
            <View
              style={[
                styles.myRankBar,
                { backgroundColor: t.primarySoft, borderTopColor: t.primary, paddingBottom: Math.max(insets.bottom, 12) },
              ]}
            >
              {myRank.position > 0 ? (
                <>
                  <View style={styles.rankContainer}>
                    <Text style={[styles.rankText, { color: t.primary }]}>{myRank.position}</Text>
                  </View>
                  <View style={styles.userInfo}>
                    <Text style={[styles.nickname, { color: t.primary }]}>我的名次</Text>
                    <Text style={[styles.detailText, { color: t.textSecondary }]}>
                      共 {myRank.totalPlayers} 名玩家上榜
                    </Text>
                  </View>
                  <View style={styles.statContainer}>{renderStat(myRank.stats)}</View>
                </>
              ) : (
                <Text style={[styles.myRankEmpty, { color: t.primary }]}>还没有战绩，打一局就能上榜啦 🎮</Text>
              )}
            </View>
          )}
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
  tabContainer: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 60, // 运行时由 insets.top 覆盖
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
  listWrapper: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  myRankBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3E8FF',
    borderTopWidth: 1,
    borderTopColor: '#6200EE',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  myRankEmpty: {
    flex: 1,
    color: '#6200EE',
    fontSize: 14,
    textAlign: 'center',
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
  itemAvatar: {
    fontSize: 26,
    marginLeft: 4,
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
  rankStat: {
    alignItems: 'flex-end',
  },
  tierText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  rankScore: {
    color: '#999',
    fontSize: 12,
    marginTop: 2,
  },
  statValue: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
