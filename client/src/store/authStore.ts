import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, UserStats } from '@maozi/shared';

interface AuthState {
  user: User | null;
  token: string | null;
  stats: UserStats | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  setAuth: (user: User, token: string, stats: UserStats) => void;
  setStats: (stats: UserStats) => void;
  /** 仅刷新用户信息与战绩（保留 token），用于启动时向服务器校验后同步 */
  setUserAndStats: (user: User, stats: UserStats) => void;
  updateNickname: (nickname: string) => void;
  logout: () => void;
  initialize: () => Promise<void>;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const STATS_KEY = 'auth_stats';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  stats: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: async (user, token, stats) => {
    try {
      await AsyncStorage.multiSet([
        [TOKEN_KEY, token],
        [USER_KEY, JSON.stringify(user)],
        [STATS_KEY, JSON.stringify(stats)],
      ]);
      set({ user, token, stats, isAuthenticated: true, isLoading: false });
    } catch (error) {
      console.error('[AuthStore] 保存认证信息失败:', error);
      // 即使存储失败，也更新内存状态
      set({ user, token, stats, isAuthenticated: true, isLoading: false });
    }
  },

  setStats: async (stats) => {
    try {
      await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (error) {
      console.error('[AuthStore] 保存统计失败:', error);
    }
    set({ stats });
  },

  setUserAndStats: async (user, stats) => {
    try {
      await AsyncStorage.multiSet([
        [USER_KEY, JSON.stringify(user)],
        [STATS_KEY, JSON.stringify(stats)],
      ]);
    } catch (error) {
      console.error('[AuthStore] 刷新用户信息失败:', error);
    }
    set({ user, stats });
  },

  updateNickname: (nickname) => {
    const { user } = get();
    if (user) {
      const updatedUser = { ...user, nickname };
      set({ user: updatedUser });
      // 异步持久化，失败时仅记录
      AsyncStorage.setItem(USER_KEY, JSON.stringify(updatedUser)).catch((err) =>
        console.error('[AuthStore] 保存昵称失败:', err)
      );
    }
  },

  logout: async () => {
    try {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, STATS_KEY]);
    } catch (error) {
      console.error('[AuthStore] 清除认证信息失败:', error);
    }
    set({ user: null, token: null, stats: null, isAuthenticated: false, isLoading: false });
  },

  initialize: async () => {
    try {
      const [[, token], [, userStr], [, statsStr]] = await AsyncStorage.multiGet([
        TOKEN_KEY,
        USER_KEY,
        STATS_KEY,
      ]);

      if (token && userStr) {
        const user = JSON.parse(userStr) as User;
        const stats = statsStr ? JSON.parse(statsStr) as UserStats : null;
        set({ user, token, stats, isAuthenticated: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
