'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Button, Input, TextArea, Drawer } from '@/components/ui';
import { emailApi } from '@/lib/api';
import { ScheduleEmailRequest } from '@/types';
import { UploadCloud, CheckCircle2, AlertTriangle, Users, Clock, Calendar, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [delayBetween, setDelayBetween] = useState('2');
  const [hourlyLimit, setHourlyLimit] = useState('50');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedRecipients = useMemo(() => {
    if (!recipientText.trim()) return [];
    const emails = recipientText
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'));
    return [...new Set(emails)];
  }, [recipientText]);

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      const emails = lines.map((line) => {
        const cols = line.split(',');
        return cols[0].trim().replace(/"/g, '');
      }).filter((e) => e.includes('@'));
      setRecipientText(emails.join('\n'));
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (parsedRecipients.length === 0) return setError('Please provide at least one valid recipient address.');
    if (!subject.trim()) return setError('Subject is required');
    if (!body.trim()) return setError('Email body is required');
    if (!scheduledAt) return setError('Schedule time is required');

    setIsSubmitting(true);

    try {
      const data: ScheduleEmailRequest = {
        subject: subject.trim(),
        body: body.trim(),
        recipients: parsedRecipients,
        scheduledAt: new Date(scheduledAt).toISOString(),
        delayBetweenEmails: parseInt(delayBetween) || 0,
        hourlyLimit: parseInt(hourlyLimit) || undefined,
      };

      const result = await emailApi.schedule(data);
      setSuccess(`${result.count} emails successfully scheduled.`);

      setTimeout(() => {
        setSubject(''); setBody(''); setRecipientText(''); setScheduledAt('');
        setDelayBetween('2'); setHourlyLimit('50');
        setSuccess('');
        onSuccess();
        onClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule delivery');
    } finally {
      setIsSubmitting(false);
    }
  };

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const minDateTime = now.toISOString().slice(0, 16);

  const delaySec = parseInt(delayBetween) || 0;
  const totalSecs = (parsedRecipients.length - 1) * delaySec;
  const estimateStr = parsedRecipients.length > 1 && totalSecs > 0 
    ? `~${totalSecs < 60 ? `${totalSecs}s` : `${Math.floor(totalSecs/60)}m ${totalSecs%60}s`}` 
    : 'Immediate';

  if (success) {
    return (
      <Drawer isOpen={isOpen} onClose={onClose} title="">
        <div className="flex flex-col items-center justify-center h-full text-center animate-slide-up">
          <div className="w-20 h-20 rounded-full bg-status-success/10 flex items-center justify-center mb-6 relative">
            <div className="absolute inset-0 bg-status-success/20 rounded-full animate-ping opacity-20" />
            <CheckCircle2 size={40} className="text-status-success" />
          </div>
          <h2 className="text-2xl font-semibold text-text-primary mb-3">Delivery Scheduled</h2>
          <p className="text-text-secondary max-w-sm mb-10 leading-relaxed">
            {success} First delivery will commence at the designated time window.
          </p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Compose Email" description="Create a scheduled delivery batch.">
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-status-error/10 border border-status-error/20 text-status-error text-sm font-medium flex items-start gap-3 animate-slide-up shrink-0">
            <AlertTriangle className="shrink-0 mt-0.5" size={16} />
            <p>{error}</p>
          </div>
        )}

        <div className="flex-1 space-y-8 pb-8">
          {/* Email Details */}
          <section className="space-y-5">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Payload</h3>
            <Input label="Subject" placeholder="Email subject line" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <TextArea label="Message Body" placeholder="Enter HTML or plain text content..." value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
          </section>

          {/* Recipients Dropzone */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Target Audience</h3>
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200",
                isDragging ? "border-accent-primary bg-accent-primary/5" : "border-border-light bg-bg-elevated hover:bg-white/5",
                parsedRecipients.length > 0 && !isDragging && "border-status-success/50 bg-status-success/5"
              )}
            >
              <input type="file" ref={fileInputRef} accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
              <UploadCloud className={cn("mx-auto mb-3", parsedRecipients.length > 0 ? "text-status-success" : "text-text-muted")} size={28} />
              
              {parsedRecipients.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-text-primary mb-1">✓ {parsedRecipients.length} recipients detected</p>
                  <p className="text-xs text-text-secondary">Click or drag to replace file</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-text-primary mb-1">Drop CSV file here</p>
                  <p className="text-xs text-text-secondary">or click to browse</p>
                </div>
              )}
            </div>
            
            {/* Manual Entry Fallback */}
            {parsedRecipients.length === 0 && (
              <div>
                <p className="text-xs text-text-muted mb-2 text-center">or paste addresses below</p>
                <textarea
                  className="w-full px-3 py-2 bg-bg-elevated border border-border-light rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all resize-none h-[80px] text-xs font-mono"
                  placeholder="alice@example.com, bob@example.com"
                  value={recipientText}
                  onChange={(e) => setRecipientText(e.target.value)}
                />
              </div>
            )}
          </section>

          {/* Schedule Engine */}
          <section className="space-y-5">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Engine Configuration</h3>
            
            <div className="bg-bg-elevated border border-border-light rounded-xl p-5 space-y-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Clock size={120} />
              </div>

              <div className="relative z-10">
                <label className="block text-sm font-medium text-text-secondary mb-2 tracking-wide flex items-center gap-1.5">
                  <Calendar size={14} /> Start Execution
                </label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2.5 bg-bg-card border border-border-light rounded-lg text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={minDateTime}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4 relative z-10">
                <Input label="Throttle (sec)" type="number" min="0" placeholder="2" value={delayBetween} onChange={(e) => setDelayBetween(e.target.value)} />
                <Input label="Hourly Max" type="number" min="1" placeholder="50" value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} />
              </div>
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="pt-6 border-t border-border-light shrink-0 flex items-center justify-between">
          <div className="text-xs">
            <p className="text-text-muted">Total Volume: <span className="text-text-primary font-semibold">{parsedRecipients.length}</span></p>
            <p className="text-text-muted">Est. Duration: <span className="text-accent-secondary font-semibold">{estimateStr}</span></p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" isLoading={isSubmitting} className="px-6">
              Initialize Delivery <ArrowRight size={14} className="ml-1.5" />
            </Button>
          </div>
        </div>
      </form>
    </Drawer>
  );
};
