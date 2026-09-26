import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-gradient-to-r from-accent-primary to-accent-secondary text-white shadow-[0_0_15px_rgba(109,74,255,0.2)] hover:shadow-[0_0_20px_rgba(109,74,255,0.4)] border border-border-light hover:border-accent-primary/50',
      secondary: 'bg-bg-elevated text-text-primary border border-border-light hover:bg-white/5',
      ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/5',
      danger: 'bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/20',
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs font-medium',
      md: 'h-9 px-4 py-2 text-sm font-medium',
      lg: 'h-11 px-6 py-2.5 text-sm font-semibold',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center rounded-lg transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary',
          'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
