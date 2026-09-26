// API response types matching backend
export interface Email {
  id: string;
  tenantId: string;
  senderId: string;
  toAddress: string;
  subject: string;
  body: string;
  scheduledAt: string;
  status: 'pending' | 'queued' | 'sent' | 'failed';
  bullJobId: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  isStarred: boolean;
  isArchived: boolean;
  sender: Sender;
}

export interface Sender {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface EmailListResponse {
  emails: Email[];
  pagination: Pagination;
}

export interface ScheduleEmailRequest {
  subject: string;
  body: string;
  recipients: string[];
  scheduledAt: string;
  delayBetweenEmails?: number;
  hourlyLimit?: number;
  senderEmail?: string;
  senderName?: string;
}

export interface ScheduleEmailResponse {
  message: string;
  count: number;
  emails: {
    id: string;
    toAddress: string;
    scheduledAt: string;
    status: string;
  }[];
}

export interface AuthResponse {
  user: User | null;
  error?: string;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channelName?: string;
  connectedAt?: string;
}

export interface EmailStats {
  pending: number;
  queued: number;
  sent: number;
  failed: number;
  total: number;
}

export interface RateLimitConfig {
  maxPerHourGlobal: number;
  maxPerHourPerSender: number;
  minDelaySeconds: number;
  workerConcurrency: number;
}
