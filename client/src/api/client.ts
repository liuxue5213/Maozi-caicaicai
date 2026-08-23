/**
 * HTTP API 客户端
 */

import { useAuthStore } from '../store/authStore';

// 服务器地址配置（通过环境变量注入，不硬编码）
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';
const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL || '';

export { API_BASE_URL, WS_BASE_URL };

interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  timeout?: number; // 超时时间（毫秒）
}

// 默认超时时间
const DEFAULT_TIMEOUT = 10000; // 10秒

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 使用 AbortController 实现超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout / 1000}秒）`);
    }
    throw new Error('网络连接失败，请检查网络');
  }
  clearTimeout(timeoutId);

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
