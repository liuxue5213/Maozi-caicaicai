/**
 * 主题体系：浅色 / 深色两套调色板 + 用户偏好（跟随系统/浅色/深色）。
 * 布局样式保持静态 StyleSheet，颜色统一在渲染时用 useTheme() 覆盖。
 */
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  mode: ThemeMode;
  /** 页面背景 */
  background: string;
  /** 卡片/容器背景 */
  card: string;
  /** 输入框背景 */
  inputBg: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  /** 主色（品牌紫） */
  primary: string;
  /** 主色柔和背景（选中态/徽章底） */
  primarySoft: string;
  /** 主色上的文字（浅色主题为白，深色主题为深色） */
  onPrimary: string;
  accent: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  /** 阴影颜色（深色主题下减弱） */
  shadowOpacity: number;
  /** 渐变顶栏（深色下用更深的紫） */
  gradient: [string, string];
  /** 白色文字（顶栏/主按钮上） */
  onGradient: string;
}

export const lightTheme: Theme = {
  mode: 'light',
  background: '#f5f5f5',
  card: '#ffffff',
  inputBg: '#ffffff',
  border: '#e0e0e0',
  text: '#333333',
  textSecondary: '#666666',
  textMuted: '#999999',
  primary: '#6200EE',
  primarySoft: '#F3E8FF',
  onPrimary: '#ffffff',
  accent: '#03DAC6',
  success: '#4CAF50',
  successSoft: '#E8F5E9',
  danger: '#E53935',
  dangerSoft: '#FFEBEE',
  warning: '#FF9800',
  warningSoft: '#FFF3E0',
  shadowOpacity: 0.1,
  gradient: ['#6200EE', '#7C4DFF'],
  onGradient: '#ffffff',
};

export const darkTheme: Theme = {
  mode: 'dark',
  background: '#121212',
  card: '#1E1E1E',
  inputBg: '#252525',
  border: '#333333',
  text: '#EAEAEA',
  textSecondary: '#AAAAAA',
  textMuted: '#777777',
  primary: '#BB86FC',
  primarySoft: '#2C2140',
  onPrimary: '#1A1A1A',
  accent: '#03DAC6',
  success: '#81C784',
  successSoft: '#1E2B1F',
  danger: '#CF6679',
  dangerSoft: '#3A2126',
  warning: '#FFB74D',
  warningSoft: '#3A2E1A',
  shadowOpacity: 0.35,
  gradient: ['#4A148C', '#6A1B9A'],
  onGradient: '#ffffff',
};

const PREF_KEY = '@maozi/theme-pref';

export type ThemePref = 'system' | 'light' | 'dark';

interface ThemePrefState {
  pref: ThemePref;
  loaded: boolean;
  setPref: (pref: ThemePref) => void;
  load: () => Promise<void>;
}

export const useThemeStore = create<ThemePrefState>((set) => ({
  pref: 'system',
  loaded: false,
  setPref: (pref) => {
    set({ pref });
    AsyncStorage.setItem(PREF_KEY, pref).catch(() => {});
  },
  load: async () => {
    try {
      const value = await AsyncStorage.getItem(PREF_KEY);
      if (value === 'light' || value === 'dark' || value === 'system') {
        set({ pref: value, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },
}));

/** 按用户偏好与系统外观解析当前主题 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  const pref = useThemeStore((s) => s.pref);
  const dark = pref === 'dark' || (pref === 'system' && scheme === 'dark');
  return dark ? darkTheme : lightTheme;
}
