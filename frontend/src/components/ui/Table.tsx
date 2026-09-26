import React from 'react';
import { cn } from '@/lib/utils';
import { InboxIcon } from 'lucide-react';

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  keyExtractor: (item: T) => string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  isLoading = false,
  emptyMessage = 'No data found',
  emptyIcon,
  keyExtractor,
}: TableProps<T>) {
  // Skeleton loader
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border-light bg-bg-card animate-fade-in">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-light bg-bg-elevated/50">
              {columns.map((col) => (
                <th key={col.key} className="px-6 py-4 text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} className="px-6 py-4">
                    <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: `${40 + Math.random() * 40}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 rounded-xl border border-dashed border-border-light bg-bg-card/50 animate-fade-in">
        {emptyIcon || (
          <div className="w-12 h-12 rounded-full bg-bg-elevated flex items-center justify-center mb-4 text-text-muted border border-border-light">
            <InboxIcon size={20} />
          </div>
        )}
        <h3 className="text-sm font-semibold text-text-primary mb-1">No entries found</h3>
        <p className="text-text-muted text-sm text-center max-w-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-light bg-bg-card animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-light bg-bg-elevated/50">
              {columns.map((col) => (
                <th key={col.key} className={cn('px-6 py-4 text-xs font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap', col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {data.map((item) => (
              <tr key={keyExtractor(item)} className="hover:bg-bg-elevated/40 transition-colors group">
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-6 py-4 text-sm text-text-primary whitespace-nowrap', col.className)}>
                    {col.render ? col.render(item) : String(item[col.key as keyof T] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
