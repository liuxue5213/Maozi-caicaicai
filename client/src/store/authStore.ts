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
    await AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [USER_KEY, JSON.stringify(user)],
      [STATS_KEY, JSON.stringify(stats)],
    ]);
    set({ user, token, stats, isAuthenticated: true, isLoading: false });
  },

  setStats: async (stats) => {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
    set({ stats });
  },

  updateNickname: (nickname) => {
    const { user } = get();
    if (user) {
      set({ user: { ...user, nickname } });
    }
  },

  logout: async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, STATS_KEY]);
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
