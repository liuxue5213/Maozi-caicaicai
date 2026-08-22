/**
 * HTTP API 客户端
 */

import { useAuthStore } from '../store/authStore';

// 服务器地址配置
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://120.48.13.152:60205/api';
const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL || 'ws://120.48.13.152:60205/ws';

export { API_BASE_URL, WS_BASE_URL };

interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `请求失败: ${response.status}`);
  }

  if (!data.success) {
    throw new Error(data.error || '请求失败');
  }

  return data.data as T;
}

// API 响应类型
interface AuthResponse {
  user: { id: string; username: string; nickname: string; avatar: string | null; createdAt: string };
  token: string;
  stats: any;
}

// API 方法
export const api = {
  // 认证
  register: (username: string, password: string, nickname: string) =>
    apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { username, password, nickname },
    }),

  login: (username: string, password: string) =>
    apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
    }),

  verifyToken: () => apiRequest<AuthResponse>('/auth/verify'),

  // 用户
  getProfile: () => apiRequest('/user/me'),

  updateNickname: (nickname: string) =>
    apiRequest('/user/nickname', {
      method: 'PUT',
      body: { nickname },
    }),

  getHistory: (limit?: number) =>
    apiRequest(`/user/history${limit ? `?limit=${limit}` : ''}`),

  // 排行榜
  getLeaderboard: (type: 'wins' | 'streak' = 'wins', limit = 100) =>
    apiRequest(`/leaderboard?type=${type}&limit=${limit}`),

  getOnlineCount: () => apiRequest<{ count: number }>('/leaderboard/online-count'),
};
