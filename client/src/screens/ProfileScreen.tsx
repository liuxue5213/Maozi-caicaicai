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
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { GAME_MODE_LABELS, getRankTier, AVATAR_PRESETS, DEFAULT_AVATAR } from '@maozi/shared';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';
import { getGameCountTitle, getWinStreakTitle } from '../utils/titles';
import { isSoundMuted, setSoundMuted } from '../utils/sounds';
import { useTheme, useThemeStore, ThemePref } from '../theme';

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
  rounds: Array<{ player: string; opponent: string; result: 'WIN' | 'LOSE' | 'DRAW' }>;
}

const CHOICE_EMOJI: Record<string, string> = { ROCK: '✊', SCISSORS: '✌️', PAPER: '✋' };
const CHOICE_TEXT: Record<string, string> = { ROCK: '石头', SCISSORS: '剪刀', PAPER: '布' };

interface AchievementItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  unlocked: boolean;
  current: number;
  target: number;
}

interface InsightsData {
  sampleGames: number;
  choiceCounts: { ROCK: number; SCISSORS: number; PAPER: number };
  choiceWinRates: { ROCK: number; SCISSORS: number; PAPER: number };
  vsAi: { games: number; wins: number; winRate: number };
  vsHuman: { games: number; wins: number; winRate: number };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const themePref = useThemeStore((s) => s.pref);
  const setThemePref = useThemeStore((s) => s.setPref);
  const { user, stats, logout, updateNickname, updateAvatar } = useAuthStore();
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(user?.nickname || '');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [achievements, setAchievements] = useState<AchievementItem[]>([]);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  /** 正在回放的对局与当前轮下标 */
  const [replayItem, setReplayItem] = useState<HistoryItem | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  /** 修改密码 / 注销账号弹窗 */
  const [passwordModal, setPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [soundOn, setSoundOn] = useState(!isSoundMuted());
  const [avatarModal, setAvatarModal] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  // 每次切到"我的"页时刷新历史、成就与统计
  useFocusEffect(
    useCallback(() => {
      api.getHistory(20).then(setHistory).catch(() => {});
      api.getAchievements().then(setAchievements).catch(() => {});
      api.getInsights().then(setInsights).catch(() => {});
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

  const handleSelectAvatar = async (avatar: string) => {
    if (savingAvatar) return;
    setSavingAvatar(true);
    try {
      await api.updateAvatar(avatar);
      updateAvatar(avatar);
      setAvatarModal(false);
    } catch (error: any) {
      Alert.alert('错误', error.message || '头像保存失败');
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleChangePassword = async () => {
    if (savingPassword) return;
    if (!oldPassword || !newPassword || !confirmPassword) {
      Alert.alert('提示', '请填写完整');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('提示', '新密码长度至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('提示', '两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('成功', '密码已修改，下次登录请使用新密码');
    } catch (error: any) {
      Alert.alert('错误', error.message || '修改失败');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleting) return;
    if (!deletePassword) {
      Alert.alert('提示', '请输入密码确认注销');
      return;
    }
    setDeleting(true);
    try {
      await api.deleteAccount(deletePassword);
      setDeleteModal(false);
      Alert.alert('已注销', '你的全部数据已删除，感谢曾经游玩', [
        { text: '确定', onPress: logout },
      ]);
    } catch (error: any) {
      Alert.alert('错误', error.message || '注销失败');
    } finally {
      setDeleting(false);
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
    <ScrollView style={[styles.container, { backgroundColor: t.background }]}>
      {/* 用户信息卡片 */}
      <View style={[styles.profileCard, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity
          style={[styles.avatar, { backgroundColor: t.primary }]}
          activeOpacity={0.8}
          onPress={() => setAvatarModal(true)}
        >
          <Text style={[styles.avatarText, { color: t.onGradient }]}>
            {user?.avatar || user?.nickname?.[0] || DEFAULT_AVATAR}
          </Text>
          <View style={[styles.avatarEditBadge, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={styles.avatarEditBadgeText}>✏️</Text>
          </View>
        </TouchableOpacity>

        {editingNickname ? (
          <View style={styles.editContainer}>
            <TextInput
              style={[styles.nicknameInput, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
              value={newNickname}
              onChangeText={setNewNickname}
              maxLength={20}
              autoFocus
            />
            <View style={styles.editButtons}>
              <TouchableOpacity onPress={() => setEditingNickname(false)}>
                <Text style={[styles.cancelText, { color: t.textMuted }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveNickname}>
                <Text style={[styles.saveText, { color: t.primary }]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditingNickname(true)}>
            <Text style={[styles.nickname, { color: t.text }]}>{user?.nickname}</Text>
            <Text style={[styles.editHint, { color: t.textMuted }]}>点击修改昵称</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 称号展示 */}
      {gameCountTitle && (
        <View style={[styles.titleCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.titleLabel, { color: t.textMuted }]}>当前称号</Text>
          <Text style={[styles.titleName, { color: gameCountTitle.color }]}>
            {gameCountTitle.name}
          </Text>
          <Text style={[styles.titleDesc, { color: t.textSecondary }]}>{gameCountTitle.description}</Text>
          {winStreakTitle && (
            <Text style={[styles.titleName, { color: winStreakTitle.color, marginTop: 8 }]}>
              {winStreakTitle.name}
            </Text>
          )}
        </View>
      )}

      {/* 战绩统计 */}
      <View style={[styles.statsCard, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.text }]}>详细战绩</Text>
        <View style={styles.statsGrid}>
          <View style={[styles.statBox, { backgroundColor: t.background }]}>
            <Text style={[styles.statNumber, { color: t.text }]}>{stats?.totalGames || 0}</Text>
            <Text style={[styles.statName, { color: t.textSecondary }]}>总场次</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: t.background }]}>
            <Text style={[styles.statNumber, { color: t.success }]}>{stats?.wins || 0}</Text>
            <Text style={[styles.statName, { color: t.textSecondary }]}>胜场</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: t.background }]}>
            <Text style={[styles.statNumber, { color: t.danger }]}>{stats?.losses || 0}</Text>
            <Text style={[styles.statName, { color: t.textSecondary }]}>负场</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: t.background }]}>
            <Text style={[styles.statNumber, { color: t.warning }]}>{stats?.draws || 0}</Text>
            <Text style={[styles.statName, { color: t.textSecondary }]}>平局</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: t.background }]}>
            <Text style={[styles.statNumber, { color: t.text }]}>
              {stats?.totalGames
                ? Math.round((stats.wins / stats.totalGames) * 100)
                : 0}%
            </Text>
            <Text style={[styles.statName, { color: t.textSecondary }]}>胜率</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: t.background }]}>
            <Text style={[styles.statNumber, { color: t.text }]}>{stats?.bestWinStreak || 0}</Text>
            <Text style={[styles.statName, { color: t.textSecondary }]}>最高连胜</Text>
          </View>
        </View>
      </View>

      {/* 段位 */}
      <View style={[styles.rankCard, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.text }]}>我的段位</Text>
        {stats && (
          <>
            <Text style={[styles.tierEmoji, { color: getRankTier(stats.rank).color }]}>
              {getRankTier(stats.rank).emoji}
            </Text>
            <Text style={[styles.tierName, { color: getRankTier(stats.rank).color }]}>
              {getRankTier(stats.rank).name}
            </Text>
            <Text style={[styles.rankScore, { color: t.textSecondary }]}>{stats.rank} 分</Text>
          </>
        )}
      </View>

      {/* 成就墙 */}
      {achievements.length > 0 && (
        <View style={[styles.achievementCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.achievementTitleRow}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>成就</Text>
            <Text style={[styles.achievementCount, { color: t.textMuted }]}>
              已解锁 {achievements.filter((a) => a.unlocked).length}/{achievements.length}
            </Text>
          </View>
          <View style={styles.achievementGrid}>
            {achievements.map((a) => (
              <View
                key={a.id}
                style={[
                  styles.achievementCell,
                  { backgroundColor: t.primarySoft, borderColor: t.primary },
                  !a.unlocked && { backgroundColor: t.background, borderColor: t.border },
                ]}
              >
                <Text style={styles.achievementEmoji}>{a.emoji}</Text>
                <Text
                  style={[styles.achievementName, { color: t.primary }, !a.unlocked && styles.achievementNameLocked]}
                  numberOfLines={1}
                >
                  {a.name}
                </Text>
                <Text style={[styles.achievementProgress, { color: t.textMuted }]}>
                  {a.unlocked ? '已达成' : `${Math.min(a.current, a.target)}/${a.target}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 出拳统计 */}
      {insights && insights.sampleGames > 0 && (() => {
        const total = insights.choiceCounts.ROCK + insights.choiceCounts.SCISSORS + insights.choiceCounts.PAPER;
        const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
        const rows = [
          { key: 'ROCK', emoji: '✊', label: '石头' },
          { key: 'SCISSORS', emoji: '✌️', label: '剪刀' },
          { key: 'PAPER', emoji: '✋', label: '布' },
        ] as const;
        return (
          <View style={[styles.insightCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.achievementTitleRow}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>📊 出拳统计</Text>
              <Text style={[styles.achievementCount, { color: t.textMuted }]}>
                基于最近 {insights.sampleGames} 局
              </Text>
            </View>
            {total > 0 ? (
              rows.map((row) => (
                <View key={row.key} style={styles.insightRow}>
                  <Text style={styles.insightEmoji}>{row.emoji}</Text>
                  <View style={styles.insightBarCol}>
                    <View style={[styles.insightBarBg, { backgroundColor: t.background }]}>
                      <View
                        style={[
                          styles.insightBarFill,
                          { backgroundColor: t.primary, width: `${pct(insights.choiceCounts[row.key])}%` },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={[styles.insightPercent, { color: t.text }]}>
                    {pct(insights.choiceCounts[row.key])}%
                  </Text>
                  <Text style={[styles.insightWinRate, { color: t.textSecondary }]}>
                    胜率 {insights.choiceWinRates[row.key]}%
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.historyEmpty, { color: t.textMuted }]}>
                打完带有回放记录的对局后，这里会出现你的出拳倾向分析
              </Text>
            )}
            <View style={[styles.insightVsRow, { borderTopColor: t.border }]}>
              <View style={styles.insightVsCell}>
                <Text style={[styles.insightVsLabel, { color: t.textSecondary }]}>🤖 人机对战</Text>
                <Text style={[styles.insightVsValue, { color: t.text }]}>
                  {insights.vsAi.games} 局 · 胜率 {insights.vsAi.winRate}%
                </Text>
              </View>
              <View style={styles.insightVsCell}>
                <Text style={[styles.insightVsLabel, { color: t.textSecondary }]}>⚔️ 真人对战</Text>
                <Text style={[styles.insightVsValue, { color: t.text }]}>
                  {insights.vsHuman.games} 局 · 胜率 {insights.vsHuman.winRate}%
                </Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* 最近对局 */}
      <View style={[styles.historyCard, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.text }]}>最近对局</Text>
        {history.length > 0 && (
          <View style={styles.trendRow}>
            {[...history].reverse().map((item) => (
              <View
                key={`trend-${item.id}`}
                style={[
                  styles.trendDot,
                  {
                    backgroundColor: item.isDraw ? t.textMuted : item.won ? t.success : t.danger,
                  },
                ]}
              />
            ))}
          </View>
        )}
        {history.length === 0 ? (
          <Text style={[styles.historyEmpty, { color: t.textMuted }]}>还没有对局记录，快去打一局吧！</Text>
        ) : (
          history.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.historyItem, { borderBottomColor: t.border }]}
              activeOpacity={0.7}
              disabled={item.rounds.length === 0}
              onPress={() => {
                setReplayItem(item);
                setReplayIndex(item.rounds.length - 1);
              }}
            >
              <View
                style={[
                  styles.resultBadge,
                  {
                    backgroundColor: item.isDraw
                      ? t.warningSoft
                      : item.won
                        ? t.successSoft
                        : t.dangerSoft,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.resultBadgeText,
                    {
                      color: item.isDraw ? t.warning : item.won ? t.success : t.danger,
                    },
                  ]}
                >
                  {item.isDraw ? '平' : item.won ? '胜' : '负'}
                </Text>
              </View>
              <View style={styles.historyInfo}>
                <Text style={[styles.historyOpponent, { color: t.text }]} numberOfLines={1}>
                  vs {item.opponentNickname}
                  {item.isAi ? '（AI）' : ''}
                </Text>
                <Text style={[styles.historyMeta, { color: t.textSecondary }]}>
                  {GAME_MODE_LABELS[item.mode as keyof typeof GAME_MODE_LABELS] ?? '对局'} ·{' '}
                  {formatTime(item.timestamp)}
                  {item.rounds.length > 0 ? ' · 点击回放' : ''}
                </Text>
              </View>
              <Text
                style={[
                  styles.historyScore,
                  { color: item.isDraw ? t.warning : item.won ? t.success : t.danger },
                ]}
              >
                {item.myScore} : {item.opponentScore}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* 设置 */}
      <View style={[styles.settingCard, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.text }]}>设置</Text>
        <View style={[styles.settingRow, { borderBottomColor: t.border }]}>
          <Text style={[styles.settingLabel, { color: t.text }]}>🔊 对局音效</Text>
          <Switch value={soundOn} onValueChange={handleToggleSound} />
        </View>
        <View style={[styles.settingRow, { borderBottomColor: t.border }]}>
          <Text style={[styles.settingLabel, { color: t.text }]}>🎨 外观</Text>
          <View style={[styles.appearanceRow, { backgroundColor: t.background }]}>
            {(['system', 'light', 'dark'] as const).map((pref) => (
              <TouchableOpacity
                key={pref}
                style={[
                  styles.appearanceOption,
                  themePref === pref && { backgroundColor: t.primary },
                ]}
                onPress={() => setThemePref(pref)}
              >
                <Text
                  style={[
                    styles.appearanceOptionText,
                    { color: t.textSecondary },
                    themePref === pref && { color: t.onPrimary, fontWeight: 'bold' as const },
                  ]}
                >
                  {pref === 'system' ? '跟随系统' : pref === 'light' ? '浅色' : '深色'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TouchableOpacity style={styles.settingRow} onPress={() => setPasswordModal(true)}>
          <Text style={[styles.settingLabel, { color: t.text }]}>🔑 修改密码</Text>
          <Text style={[styles.settingArrow, { color: t.textMuted }]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* 退出登录 */}
      <TouchableOpacity
        style={[styles.logoutButton, { backgroundColor: t.card, borderColor: t.border }]}
        onPress={handleLogout}
      >
        <Text style={[styles.logoutText, { color: t.textSecondary }]}>退出登录</Text>
      </TouchableOpacity>

      {/* 危险区：注销账号 */}
      <TouchableOpacity style={styles.deleteAccountButton} onPress={() => setDeleteModal(true)}>
        <Text style={styles.deleteAccountText}>注销账号（删除全部数据）</Text>
      </TouchableOpacity>

      {/* 头像选择弹窗 */}
      <Modal
        visible={avatarModal}
        transparent
        animationType="fade"
        onRequestClose={() => setAvatarModal(false)}
      >
        <View style={styles.avatarModalOverlay}>
          <View style={[styles.avatarModalCard, { backgroundColor: t.card }]}>
            <Text style={[styles.avatarModalTitle, { color: t.text }]}>选择头像</Text>
            <Text style={[styles.avatarModalDesc, { color: t.textMuted }]}>选一个喜欢的形象，对手在对局里能看到</Text>
            <View style={styles.avatarGrid}>
              {AVATAR_PRESETS.map((avatar) => {
                const isCurrent = user?.avatar === avatar;
                return (
                  <TouchableOpacity
                    key={avatar}
                    style={[
                      styles.avatarCell,
                      { backgroundColor: t.background },
                      isCurrent && { backgroundColor: t.primarySoft, borderColor: t.primary },
                    ]}
                    onPress={() => handleSelectAvatar(avatar)}
                    disabled={savingAvatar}
                  >
                    <Text style={styles.avatarCellText}>{avatar}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={styles.avatarModalCancel}
              onPress={() => setAvatarModal(false)}
            >
              <Text style={[styles.avatarModalCancelText, { color: t.textMuted }]}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 对局回放弹窗 */}
      <Modal
        visible={replayItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReplayItem(null)}
      >
        <View style={styles.replayOverlay}>
          <View style={[styles.replayCard, { backgroundColor: t.card }]}>
            <Text style={[styles.replayTitle, { color: t.text }]} numberOfLines={1}>
              vs {replayItem?.opponentNickname || ''}
              {replayItem?.isAi ? '（AI）' : ''}
            </Text>
            <Text style={[styles.replayScore, { color: t.textSecondary }]}>
              终局比分 {replayItem?.myScore} : {replayItem?.opponentScore}
            </Text>

            {replayItem && replayItem.rounds.length > 0 && (
              <>
                <Text style={[styles.replayRoundLabel, { color: t.textMuted }]}>
                  第 {replayIndex + 1} / {replayItem.rounds.length} 轮
                </Text>
                <View style={styles.replayRow}>
                  <View style={styles.replaySide}>
                    <View style={[styles.replayCircle, { backgroundColor: t.background, borderColor: t.border }]}>
                      <Text style={styles.replayEmoji}>
                        {CHOICE_EMOJI[replayItem.rounds[replayIndex].player] || '❓'}
                      </Text>
                    </View>
                    <Text style={[styles.replayName, { color: t.text }]}>
                      我 · {CHOICE_TEXT[replayItem.rounds[replayIndex].player] || ''}
                    </Text>
                  </View>
                  <Text style={[styles.replayVs, { color: t.textMuted }]}>VS</Text>
                  <View style={styles.replaySide}>
                    <View style={[styles.replayCircle, { backgroundColor: t.background, borderColor: t.border }]}>
                      <Text style={styles.replayEmoji}>
                        {CHOICE_EMOJI[replayItem.rounds[replayIndex].opponent] || '❓'}
                      </Text>
                    </View>
                    <Text style={[styles.replayName, { color: t.text }]}>
                      {replayItem.opponentNickname} · {CHOICE_TEXT[replayItem.rounds[replayIndex].opponent] || ''}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.replayResult,
                    {
                      color:
                        replayItem.rounds[replayIndex].result === 'DRAW'
                          ? t.warning
                          : replayItem.rounds[replayIndex].result === 'WIN'
                            ? t.success
                            : t.danger,
                    },
                  ]}
                >
                  {replayItem.rounds[replayIndex].result === 'DRAW'
                    ? '平局'
                    : replayItem.rounds[replayIndex].result === 'WIN'
                      ? '这一局你赢了'
                      : '这一局你输了'}
                </Text>

                <View style={styles.replayControls}>
                  <TouchableOpacity
                    style={[styles.replayNavButton, { borderColor: t.border }, replayIndex === 0 && { opacity: 0.4 }]}
                    disabled={replayIndex === 0}
                    onPress={() => setReplayIndex((i) => Math.max(0, i - 1))}
                  >
                    <Text style={[styles.replayNavText, { color: t.textSecondary }]}>← 上一轮</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.replayNavButton, { borderColor: t.border }, replayIndex === replayItem.rounds.length - 1 && { opacity: 0.4 }]}
                    disabled={replayIndex === replayItem.rounds.length - 1}
                    onPress={() => setReplayIndex((i) => Math.min(replayItem.rounds.length - 1, i + 1))}
                  >
                    <Text style={[styles.replayNavText, { color: t.textSecondary }]}>下一轮 →</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.avatarModalCancel} onPress={() => setReplayItem(null)}>
              <Text style={[styles.avatarModalCancelText, { color: t.textMuted }]}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal
        visible={passwordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setPasswordModal(false)}
      >
        <View style={styles.replayOverlay}>
          <View style={[styles.replayCard, { backgroundColor: t.card }]}>
            <Text style={[styles.replayTitle, { color: t.text }]}>修改密码</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: t.background, borderColor: t.border, color: t.text }]}
              placeholder="当前密码"
              placeholderTextColor={t.textMuted}
              value={oldPassword}
              onChangeText={setOldPassword}
              secureTextEntry
              autoFocus
            />
            <TextInput
              style={[styles.modalInput, { backgroundColor: t.background, borderColor: t.border, color: t.text }]}
              placeholder="新密码（至少 6 位）"
              placeholderTextColor={t.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <TextInput
              style={[styles.modalInput, { backgroundColor: t.background, borderColor: t.border, color: t.text }]}
              placeholder="确认新密码"
              placeholderTextColor={t.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.modalPrimaryButton, { backgroundColor: t.primary }, savingPassword && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={savingPassword}
            >
              <Text style={[styles.modalPrimaryButtonText, { color: t.onGradient }]}>
                {savingPassword ? '保存中...' : '保存新密码'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.avatarModalCancel} onPress={() => setPasswordModal(false)}>
              <Text style={[styles.avatarModalCancelText, { color: t.textMuted }]}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 注销账号弹窗 */}
      <Modal
        visible={deleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModal(false)}
      >
        <View style={styles.replayOverlay}>
          <View style={[styles.replayCard, { backgroundColor: t.card }]}>
            <Text style={[styles.replayTitle, { color: t.danger }]}>⚠️ 注销账号</Text>
            <Text style={[styles.deleteWarnText, { color: t.textSecondary }]}>
              将永久删除你的账号、战绩、成就、好友和全部对局记录，且无法恢复。确定要继续吗？
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: t.background, borderColor: t.border, color: t.text }]}
              placeholder="输入登录密码确认"
              placeholderTextColor={t.textMuted}
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              autoFocus
            />
            <TouchableOpacity
              style={[styles.modalPrimaryButton, { backgroundColor: t.danger }, deleting && { opacity: 0.6 }]}
              onPress={handleDeleteAccount}
              disabled={deleting}
            >
              <Text style={[styles.modalPrimaryButtonText, { color: '#fff' }]}>
                {deleting ? '注销中...' : '永久删除我的账号'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.avatarModalCancel} onPress={() => setDeleteModal(false)}>
              <Text style={[styles.avatarModalCancelText, { color: t.textMuted }]}>取消</Text>
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
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadgeText: {
    fontSize: 12,
  },
  avatarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  avatarModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
  },
  avatarModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  avatarModalDesc: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  avatarCell: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCellActive: {
    borderColor: '#6200EE',
    backgroundColor: '#F3E8FF',
  },
  avatarCellText: {
    fontSize: 30,
  },
  avatarModalCancel: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  avatarModalCancelText: {
    color: '#999',
    fontSize: 15,
  },
  achievementCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  achievementTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  achievementCount: {
    color: '#999',
    fontSize: 13,
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  achievementCell: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: '#F3E8FF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6200EE',
  },
  achievementCellLocked: {
    backgroundColor: '#f5f5f5',
    borderColor: '#e0e0e0',
  },
  achievementEmoji: {
    fontSize: 22,
  },
  achievementName: {
    color: '#6200EE',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 4,
  },
  achievementNameLocked: {
    color: '#999',
  },
  achievementProgress: {
    color: '#999',
    fontSize: 10,
    marginTop: 2,
  },
  trendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 10,
    marginBottom: 6,
  },
  trendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  insightCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  insightEmoji: {
    fontSize: 20,
    width: 30,
    textAlign: 'center',
  },
  insightBarCol: {
    flex: 1,
  },
  insightBarBg: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  insightBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  insightPercent: {
    width: 40,
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  insightWinRate: {
    width: 62,
    fontSize: 11,
    textAlign: 'right',
  },
  insightVsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    marginTop: 16,
    paddingTop: 12,
  },
  insightVsCell: {
    flex: 1,
    alignItems: 'center',
  },
  insightVsLabel: {
    fontSize: 12,
  },
  insightVsValue: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  appearanceRow: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  appearanceOption: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  appearanceOptionText: {
    fontSize: 12,
  },
  replayOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  replayCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  replayTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  replayScore: {
    fontSize: 13,
    marginTop: 4,
  },
  replayRoundLabel: {
    fontSize: 13,
    marginTop: 14,
  },
  replayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginTop: 12,
  },
  replaySide: {
    alignItems: 'center',
    width: 110,
  },
  replayCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayEmoji: {
    fontSize: 34,
  },
  replayName: {
    fontSize: 12,
    marginTop: 8,
  },
  replayVs: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  replayResult: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
  },
  replayControls: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  replayNavButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  replayNavText: {
    fontSize: 14,
  },
  modalInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    marginTop: 10,
  },
  modalPrimaryButton: {
    width: '100%',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  modalPrimaryButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  settingArrow: {
    fontSize: 20,
  },
  deleteAccountButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 30,
  },
  deleteAccountText: {
    color: '#C62828',
    fontSize: 14,
  },
  deleteWarnText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
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
