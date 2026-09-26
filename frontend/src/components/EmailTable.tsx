'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Table, Badge } from '@/components/ui';
import { emailApi } from '@/lib/api';
import { Email } from '@/types';
import { Search, ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle, PlayCircle, Loader2 } from 'lucide-react';

interface EmailTableProps {
  type: 'scheduled' | 'sent';
  refreshKey: number;
}

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'pending': return { variant: 'warning' as const, icon: Clock, label: 'PENDING' };
    case 'queued': return { variant: 'info' as const, icon: PlayCircle, label: 'QUEUED' };
    case 'sent': return { variant: 'success' as const, icon: CheckCircle2, label: 'SENT' };
    case 'failed': return { variant: 'danger' as const, icon: XCircle, label: 'FAILED' };
    default: return { variant: 'default' as const, icon: Clock, label: status.toUpperCase() };
  }
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const EmailTable: React.FC<EmailTableProps> = ({ type, refreshKey }) => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchEmails = useCallback(async () => {
    setIsLoading(true);
    try {
      const api = type === 'scheduled' ? emailApi.getScheduled : emailApi.getSent;
      const result = await api(page, 15, searchQuery || undefined);
      setEmails(result.emails);
      setTotalPages(result.pagination.totalPages);
      setTotal(result.pagination.total);
    } catch (error) {
      console.error('Failed to fetch emails:', error);
    } finally {
      setIsLoading(false);
    }
  }, [type, page, searchQuery, refreshKey]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  useEffect(() => {
    if (type === 'scheduled') {
      const interval = setInterval(fetchEmails, 5000);
      return () => clearInterval(interval);
    }
  }, [fetchEmails, type]);

  const columns = [
    {
      key: 'toAddress',
      header: 'Recipient',
      render: (email: Email) => (
        <span className="font-medium text-text-primary tracking-wide">{email.toAddress}</span>
      ),
    },
    { key: 'subject', header: 'Subject', className: 'text-text-secondary max-w-[200px] truncate' },
    {
      key: type === 'scheduled' ? 'scheduledAt' : 'sentAt',
      header: type === 'scheduled' ? 'Scheduled' : 'Sent At',
      render: (email: Email) => (
        <span className="text-text-secondary">
          {formatDate(type === 'scheduled' ? email.scheduledAt : email.sentAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (email: Email) => {
        const config = getStatusConfig(email.status);
        const Icon = config.icon;
        return (
          <Badge variant={config.variant} className="gap-1.5">
            <Icon size={10} />
            {config.label}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
          <input
            type="text"
            placeholder="Search recipients, subject..."
            className="w-full pl-9 pr-4 h-10 bg-bg-elevated border border-border-light rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary focus:border-accent-primary transition-all"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="text-xs font-semibold text-text-muted tracking-wide uppercase">
          <span className="text-text-primary mr-1">{total}</span> RECORDS
        </div>
      </div>

      <Table
        columns={columns}
        data={emails}
        isLoading={isLoading}
        emptyMessage={
          type === 'scheduled'
            ? "Your scheduled queue is empty. Start a new batch."
            : "No sent history found."
        }
        keyExtractor={(email) => email.id}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary hover:bg-white/5 rounded-md disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <span className="text-xs font-medium text-text-muted tracking-widest">
            <span className="text-text-primary">{page}</span> / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary hover:bg-white/5 rounded-md disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
