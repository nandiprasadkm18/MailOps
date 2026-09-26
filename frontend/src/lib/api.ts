import {
  AuthResponse,
  EmailListResponse,
  ScheduleEmailRequest,
  ScheduleEmailResponse,
  SlackStatus,
  EmailStats,
  RateLimitConfig,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorBody.error || `API error: ${res.status}`);
  }

  return res.json();
}

// Auth
export const authApi = {
  getMe: () => fetchApi<AuthResponse>('/api/auth/me'),
  login: (email: string, password?: string) =>
    fetchApi<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => fetchApi<{ message: string }>('/api/auth/logout', { method: 'POST' }),
  getGoogleAuthUrl: () => `${API_BASE}/api/auth/google`,
};

// Emails
export const emailApi = {
  schedule: (data: ScheduleEmailRequest) =>
    fetchApi<ScheduleEmailResponse>('/api/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getScheduled: (page = 1, limit = 50, search?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    return fetchApi<EmailListResponse>(`/api/emails/scheduled?${params}`);
  },
  getSent: (page = 1, limit = 50, search?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    return fetchApi<EmailListResponse>(`/api/emails/sent?${params}`);
  },
  search: (query: string, page = 1, limit = 50) => {
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });
    return fetchApi<EmailListResponse>(`/api/emails/search?${params}`);
  },
  getStats: () => fetchApi<EmailStats>('/api/emails/stats'),
  deleteEmail: (id: string) => fetchApi<{ message: string }>(`/api/emails/${id}`, { method: 'DELETE' }),
  toggleStar: (id: string, isStarred: boolean) => 
    fetchApi<Email>(`/api/emails/${id}/star`, { method: 'PUT', body: JSON.stringify({ isStarred }) }),
  toggleArchive: (id: string, isArchived: boolean) => 
    fetchApi<Email>(`/api/emails/${id}/archive`, { method: 'PUT', body: JSON.stringify({ isArchived }) }),
};

// Slack
export const slackApi = {
  getStatus: () => fetchApi<SlackStatus>('/api/slack/status'),
  getConnectUrl: () => `${API_BASE}/api/slack/connect`,
  disconnect: () => fetchApi<{ message: string }>('/api/slack/disconnect', { method: 'DELETE' }),
  test: () => fetchApi<{ message: string }>('/api/slack/test', { method: 'POST' }),
};

// Config
export const configApi = {
  getRateLimits: () => fetchApi<RateLimitConfig>('/api/config/rate-limits'),
};
