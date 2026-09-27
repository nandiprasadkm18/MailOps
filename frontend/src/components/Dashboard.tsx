'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { authApi, emailApi, slackApi } from '@/lib/api';
import { User, EmailStats, SlackStatus, Email, ScheduleEmailRequest } from '@/types';
import { 
  Search, Filter, RotateCw, Star, Clock, Send, 
  ChevronDown, Paperclip, Upload, ArrowLeft,
  Undo, Redo, Type, Bold, Italic, Underline,
  AlignLeft, ChevronsUpDown, ListOrdered, List,
  Indent, Quote, Link, Strikethrough, Calendar,
  Trash2, Box, LogOut, X, Blocks
} from 'lucide-react';
import { cn } from '@/lib/utils';
import 'quill/dist/quill.snow.css';
import Integrations from './Integrations';

type ViewState = 'scheduled' | 'sent' | 'integrations';

const formatEmailTimestamp = (dateString: string | null | undefined) => {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  const datePart = d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${datePart} · ${timePart}`;
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewState>('scheduled');
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  
  // Login State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginName, setLoginName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  // Compose State
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [delayBetween, setDelayBetween] = useState('2');
  const [delayUnit, setDelayUnit] = useState('Seconds');
  const [hourlyLimit, setHourlyLimit] = useState('10');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScheduleDropdown, setShowScheduleDropdown] = useState(false);
  const [uploadedFileCount, setUploadedFileCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const quillRef = useRef<any>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (isComposeOpen && editorRef.current && !quillRef.current) {
        const Quill = (await import('quill')).default;
        
        if (!isMounted) return;

        quillRef.current = new Quill(editorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: {
            container: '#toolbar',
            handlers: {
              undo: function() {
                // @ts-ignore
                this.quill.history.undo();
              },
              redo: function() {
                // @ts-ignore
                this.quill.history.redo();
              },
              link: function(value: string) {
                if (value) {
                  const href = prompt('Enter the URL');
                  if (href) {
                    // @ts-ignore
                    this.quill.format('link', href);
                  }
                } else {
                  // @ts-ignore
                  this.quill.format('link', false);
                }
              }
            }
          },
          history: {
            delay: 500,
            maxStack: 100,
            userOnly: true
          }
        },
        placeholder: 'Type Your Reply...'
      });

      quillRef.current.on('text-change', () => {
        setBody(quillRef.current.root.innerHTML);
      });
      
        // Load initial state if present (useful for drafts later)
        if (body) {
          quillRef.current.root.innerHTML = body;
        }
      } else if (!isComposeOpen && quillRef.current) {
        // Cleanup old instance when compose window closes
        quillRef.current = null;
      }
    })();
    return () => { isMounted = false; };
  }, [isComposeOpen]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await authApi.getMe();
        setUser(result.user);
      } catch {
        setUser(null);
      } finally {
        setIsAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  const fetchEmails = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingEmails(true);
    try {
      const api = activeTab === 'scheduled' ? emailApi.getScheduled : emailApi.getSent;
      const result = await api(1, 50, searchQuery || undefined);
      setEmails(result.emails);
    } catch (error) {
      console.error('Failed to fetch emails:', error);
    } finally {
      if (!silent) setIsLoadingEmails(false);
    }
  }, [activeTab, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const statsResult = await emailApi.getStats();
      setStats(statsResult);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  useEffect(() => {
    if (user && !isComposeOpen) {
      fetchEmails(false);
      fetchStats();
      const interval = setInterval(() => {
        fetchEmails(true);
        fetchStats();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [user, activeTab, isComposeOpen, fetchEmails, fetchStats]);

  const handleToggleStar = async (e: React.MouseEvent, emailToUpdate: Email) => {
    e.stopPropagation();
    try {
      const updated = await emailApi.toggleStar(emailToUpdate.id, !emailToUpdate.isStarred);
      setEmails(prev => prev.map(em => em.id === updated.id ? updated : em));
      if (selectedEmail?.id === updated.id) setSelectedEmail(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleArchive = async (e: React.MouseEvent, emailToUpdate: Email) => {
    e.stopPropagation();
    try {
      const updated = await emailApi.toggleArchive(emailToUpdate.id, !emailToUpdate.isArchived);
      setEmails(prev => prev.map(em => em.id === updated.id ? updated : em));
      if (selectedEmail?.id === updated.id) setSelectedEmail(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const addRecipient = (emailStr: string) => {
    const emails = emailStr
      .split(/[\n,; ]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'));
    
    if (emails.length > 0) {
      setRecipients(prev => [...new Set([...prev, ...emails])]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      const emailsList = lines.map((line) => {
        const cols = line.split(',');
        return cols[0].trim().replace(/"/g, '');
      }).filter((e) => e.includes('@'));
      
      const uniqueEmails = [...new Set(emailsList)];
      setUploadedFileCount(uniqueEmails.length);
      
      if (uniqueEmails.length === 0) {
        alert('0 email addresses detected');
      } else {
        addRecipient(uniqueEmails.join(','));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleScheduleSubmit = async () => {
    // Attempt to add whatever is left in the input buffer
    addRecipient(recipientText);
    const finalRecipients = [...new Set([...recipients, ...recipientText.split(/[\n,; ]+/).map(e => e.trim()).filter(e => e.includes('@'))])];

    if (finalRecipients.length === 0) return alert('Please provide at least one valid recipient address.');
    if (!subject.trim()) return alert('Subject is required');
    if (!body.trim()) return alert('Email body is required');

    const parsedDelay = parseInt(delayBetween);
    const parsedLimit = parseInt(hourlyLimit);

    if (isNaN(parsedDelay) || parsedDelay < 0) return alert('Enter a valid delay (minimum 0).');
    if (isNaN(parsedLimit) || parsedLimit < 1) return alert('Hourly limit must be at least 1.');

    const finalDelaySeconds = delayUnit === 'Minutes' ? parsedDelay * 60 : parsedDelay;

    setIsSubmitting(true);
    try {
      const data: ScheduleEmailRequest = {
        subject: subject.trim(),
        body: body.trim(),
        recipients: finalRecipients,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString(),
        delayBetweenEmails: finalDelaySeconds,
        hourlyLimit: parsedLimit,
        senderEmail: user?.email,
        senderName: user?.name,
      };

      await emailApi.schedule(data);
      alert('Emails successfully scheduled.');
      
      setSubject(''); setBody(''); setRecipientText(''); setRecipients([]); setScheduledAt('');
      setDelayBetween('2'); setDelayUnit('Seconds'); setHourlyLimit('10');
      setUploadedFileCount(null);
      setIsComposeOpen(false);
      setActiveTab('scheduled');
      setShowScheduleDropdown(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to schedule delivery');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthLoading) return <div className="h-full flex items-center justify-center text-white">Loading...</div>;

  if (!user) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col items-center justify-center p-4 z-50">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">ReachSched</h1>
        </div>
        <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
              {authMode === 'login' ? 'Login' : 'Create an account'}
            </h2>
          </div>
          
          <a
            href={authApi.getGoogleAuthUrl()}
            className="flex items-center justify-center gap-3 w-full px-4 py-2.5 bg-white text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors border border-gray-300 shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Login with Google
          </a>

          <div className="relative my-6 flex items-center">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink-0 mx-4 text-xs font-medium text-gray-400 bg-white px-2">or continue with email</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <div className="space-y-4">
            {authError && (
              <div className="p-3 bg-red-50 text-red-600 text-sm font-medium rounded-lg text-center">
                {authError}
              </div>
            )}
            
            {authMode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input 
                  type="text" 
                  placeholder="Enter your name" 
                  value={loginName}
                  onChange={e => setLoginName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F5F7F6] border border-transparent rounded-lg text-sm outline-none focus:border-gray-300 focus:bg-white transition-colors" 
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email ID</label>
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className="w-full px-3 py-2 bg-[#F5F7F6] border border-transparent rounded-lg text-sm outline-none focus:border-gray-300 focus:bg-white transition-colors" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input 
                type="password" 
                placeholder="Enter your password" 
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && loginEmail && loginPassword) {
                    const submitBtn = document.getElementById('auth-submit-btn');
                    if (submitBtn) submitBtn.click();
                  }
                }}
                className="w-full px-3 py-2 bg-[#F5F7F6] border border-transparent rounded-lg text-sm outline-none focus:border-gray-300 focus:bg-white transition-colors" 
              />
            </div>
            
            <button 
              id="auth-submit-btn"
              disabled={isLoginLoading || !loginEmail || !loginPassword || (authMode === 'register' && !loginName)}
              onClick={async () => {
                setAuthError('');
                setIsLoginLoading(true);
                try {
                  let res;
                  if (authMode === 'login') {
                    res = await authApi.login(loginEmail, loginPassword);
                  } else {
                    res = await authApi.register(loginEmail, loginPassword, loginName);
                  }
                  setUser(res.user);
                } catch (e: any) {
                  // We catch and display the error in the UI. Next.js dev server overlay 
                  // can aggressively pop up if we console.error it, so we just set state.
                  setAuthError(e.message || 'Authentication failed');
                } finally {
                  setIsLoginLoading(false);
                }
              }}
              className="w-full mt-2 px-4 py-2.5 bg-[#00A63C] text-white font-semibold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoginLoading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Create account')}
            </button>
            
            <div className="text-center mt-4">
              <button
                type="button"
                className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
              >
                {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Login'}
              </button>
            </div>
            
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full w-full min-h-0">
      {/* Main Application Shell */}
      <div className="flex-1 bg-white rounded-t-xl sm:rounded-xl shadow-2xl flex overflow-hidden">
        
        {/* Left Sidebar */}
        <div className="w-64 border-r border-gray-100 flex flex-col p-4 shrink-0 bg-white z-20">
          <div className="text-2xl font-black tracking-tight mb-6 mt-2 ml-2">ReachSched</div>
          
          <div className="relative mb-6">
            <div 
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center justify-between bg-gray-50/80 rounded-xl p-2.5 border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} referrerPolicy="no-referrer" className="w-9 h-9 rounded-full bg-gray-200 shrink-0" alt="Avatar" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-[#E85D04] shrink-0 flex items-center justify-center font-bold text-white">
                    {user.name?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-gray-900 truncate leading-tight">{user.name}</span>
                  <span className="text-[11px] text-gray-500 truncate leading-tight">{user.email}</span>
                </div>
              </div>
              <ChevronDown size={14} className="text-gray-400 shrink-0 mx-1" />
            </div>

            {showProfileMenu && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden z-50">
                <button 
                  onClick={() => {
                    setActiveTab('integrations');
                    setIsComposeOpen(false);
                    setSelectedEmail(null);
                    setShowProfileMenu(false);
                  }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 font-semibold hover:bg-gray-50 flex items-center gap-2 transition-colors border-b border-gray-100"
                >
                  <Blocks size={16} /> Integrations
                </button>
                <button 
                  onClick={async () => {
                    await authApi.logout();
                    setUser(null);
                  }}
                  className="w-full text-left px-4 py-3 text-sm text-red-600 font-semibold hover:bg-gray-50 flex items-center gap-2 transition-colors"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
          
          <button 
            onClick={() => { setIsComposeOpen(true); setSelectedEmail(null); }} 
            className="w-full py-2.5 rounded-full border-[1.5px] border-[#22C55E] text-[#22C55E] font-semibold text-sm hover:bg-green-50 transition-colors mb-6"
          >
            Compose
          </button>
          
          <div className="text-[11px] font-bold text-gray-400 mb-2 ml-1 uppercase tracking-wider">CORE</div>
          
          <div className="space-y-1">
            <button 
              onClick={() => { setActiveTab('scheduled'); setIsComposeOpen(false); setSelectedEmail(null); }} 
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                activeTab === 'scheduled' && !isComposeOpen && !selectedEmail ? "bg-[#E8F5E9] text-gray-900" : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Clock size={16} className={activeTab === 'scheduled' && !isComposeOpen && !selectedEmail ? "text-gray-900" : "text-gray-400"} />
                Scheduled
              </div>
              <span className="text-gray-400 text-[11px]">{(stats?.pending || 0) + (stats?.queued || 0)}</span>
            </button>

            <button 
              onClick={() => { setActiveTab('sent'); setIsComposeOpen(false); setSelectedEmail(null); }} 
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                activeTab === 'sent' && !isComposeOpen && !selectedEmail ? "bg-[#E8F5E9] text-gray-900" : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Send size={16} className={activeTab === 'sent' && !isComposeOpen && !selectedEmail ? "text-gray-900" : "text-gray-400"} />
                Sent
              </div>
              <span className="text-gray-400 text-[11px]">{stats?.sent || 0}</span>
            </button>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white relative">
          
          {selectedEmail ? (
            /* EMAIL DETAIL VIEW */
            <div className="flex flex-col h-full animate-fade-in relative bg-white">
              {/* Detail Toolbar */}
              <div className="h-[72px] flex items-center justify-between px-8 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-4">
                  <button onClick={() => setSelectedEmail(null)} className="text-gray-600 hover:text-gray-900 transition-colors">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="text-lg font-semibold text-gray-800 tracking-tight truncate max-w-2xl">
                    {selectedEmail.subject || '(No subject)'}
                  </span>
                </div>
                <div className="flex items-center gap-5 text-gray-400">
                  <button onClick={(e) => handleToggleStar(e, selectedEmail)} className={`transition-colors ${selectedEmail.isStarred ? 'text-yellow-400 hover:text-yellow-500' : 'hover:text-gray-600'}`}>
                    <Star size={18} fill={selectedEmail.isStarred ? "currentColor" : "none"} />
                  </button>
                  <button onClick={(e) => handleToggleArchive(e, selectedEmail)} className={`transition-colors ${selectedEmail.isArchived ? 'text-blue-500 hover:text-blue-600' : 'hover:text-gray-600'}`}>
                    <Box size={18} fill={selectedEmail.isArchived ? "currentColor" : "none"} />
                  </button>
                  <button 
                    onClick={async () => {
                      if (!window.confirm('Are you sure you want to delete this email?')) return;
                      try {
                        await emailApi.deleteEmail(selectedEmail.id);
                        setSelectedEmail(null);
                        fetchEmails();
                        fetchStats();
                      } catch (err) {
                        console.error(err);
                        alert('Failed to delete email');
                      }
                    }} 
                    className="hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} referrerPolicy="no-referrer" className="w-9 h-9 rounded-full ml-2" alt="Avatar" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#E85D04] ml-2 flex items-center justify-center font-bold text-white text-sm">
                      {user?.name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>

              {/* Email Content */}
              <div className="flex-1 overflow-y-auto px-12 py-10 max-w-5xl">
                <div className="flex items-start justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#22C55E] text-white flex items-center justify-center font-bold text-lg shrink-0">
                      {(selectedEmail.sender?.name || user?.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex flex-col">
                        <span className="font-bold text-[15px] text-gray-900 leading-tight">{selectedEmail.sender?.name || user?.name}</span>
                        <span className="text-sm text-gray-500 leading-tight">{selectedEmail.sender?.email || user?.email}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                        to {selectedEmail.toAddress} <ChevronDown size={12} />
                      </div>
                    </div>
                  </div>
                  <div className="text-[13px] font-medium text-gray-500">
                    {new Date(selectedEmail.scheduledAt || selectedEmail.sentAt || selectedEmail.createdAt || new Date()).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
                    })}
                  </div>
                </div>

                <div 
                  className="text-[15px] leading-relaxed text-gray-800 font-medium [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                  dangerouslySetInnerHTML={{ __html: selectedEmail.body }}
                />
              </div>
            </div>
          ) : !isComposeOpen ? (
            activeTab === 'integrations' ? (
              <Integrations />
            ) : (
            /* LIST VIEW */
            <>
              {/* Toolbar */}
              <div className="h-[72px] flex items-center px-8 border-b border-gray-100 gap-6 shrink-0">
                <div className="flex-1 max-w-xl relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search" 
                    className="w-full bg-[#F5F6F8] border-none rounded-full h-10 pl-11 pr-4 text-sm font-medium text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-gray-200 outline-none" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <button className="p-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors"><Filter size={18} /></button>
                  <button onClick={() => fetchEmails()} className="p-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors"><RotateCw size={18} /></button>
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {isLoadingEmails ? (
                  <div className="p-8 text-center text-sm text-gray-500 font-medium">Loading...</div>
                ) : emails.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400 font-medium">No emails found.</div>
                ) : (
                  emails.map(email => (
                    <div 
                      key={email.id} 
                      onClick={() => setSelectedEmail(email)}
                      className="flex items-center justify-between px-8 py-5 border-b border-gray-50 group hover:bg-gray-50/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-6 min-w-0 flex-1">
                        <span className="text-[13px] font-bold text-gray-800 w-48 shrink-0 truncate">
                          To: {email.toAddress}
                        </span>
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="px-2.5 py-1 rounded-full bg-[#F3F4F6] text-gray-500 text-[10px] font-bold shrink-0 uppercase tracking-wide">
                            {email.status}
                          </span>
                          <span className="text-[13px] text-gray-800 font-bold truncate shrink-0 max-w-[300px]">
                            {email.subject || '(No subject)'}
                          </span>
                          <span className="text-[13px] text-gray-400 truncate min-w-0">
                            - {email.body.replace(/<[^>]*>?/gm, '').substring(0, 80) || 'Empty body'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 shrink-0">
                        {activeTab === 'scheduled' ? (
                          email.scheduledAt && (
                            <span className="text-[12px] font-medium text-gray-400">
                              Scheduled: {formatEmailTimestamp(email.scheduledAt)}
                            </span>
                          )
                        ) : (
                          (email.sentAt || email.updatedAt) && (
                            <span className="text-[12px] font-medium text-gray-400">
                              {email.status === 'failed' ? 'Failed' : 'Sent'}: {formatEmailTimestamp(email.sentAt || email.updatedAt)}
                            </span>
                          )
                        )}
                        <button 
                          onClick={(e) => handleToggleStar(e, email)}
                          className={`p-1.5 shrink-0 transition-colors ${email.isStarred ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-300 hover:text-gray-400'}`}
                        >
                          <Star size={16} fill={email.isStarred ? "currentColor" : "none"} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
            )
          ) : (
            /* COMPOSE VIEW */
            <div className="flex flex-col h-full animate-fade-in relative">
              {/* Compose Toolbar */}
              <div className="h-[72px] flex items-center justify-between px-8 border-b border-gray-100 shrink-0 relative z-30">
                <div className="flex items-center gap-4">
                  <button onClick={() => setIsComposeOpen(false)} className="text-gray-600 hover:text-gray-900 transition-colors">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="text-lg font-semibold text-gray-800 tracking-tight">Compose New Email</span>
                </div>
                
                <div className="flex items-center gap-4">
                  <button onClick={() => alert('File attachments are coming in a future update!')} className="p-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors" title="Attach file">
                    <Paperclip size={18} />
                  </button>
                  <button 
                    onClick={() => setShowScheduleDropdown(!showScheduleDropdown)} 
                    className="p-2 text-[#22C55E] hover:bg-green-50 rounded-full transition-colors"
                  >
                    <Clock size={18} />
                  </button>
                  <button 
                    onClick={handleScheduleSubmit} 
                    disabled={isSubmitting}
                    className="px-6 py-1.5 rounded-full border-[1.5px] border-[#22C55E] text-[#22C55E] font-semibold text-sm hover:bg-green-50 transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Sending...' : 'Send Later'}
                  </button>
                </div>

                {/* Send Later Dropdown */}
                {showScheduleDropdown && (
                  <div className="absolute top-[60px] right-8 w-64 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 p-4 z-50">
                    <h4 className="font-semibold text-gray-900 text-sm mb-3">Send Later</h4>
                    <div className="relative mb-4">
                      <input 
                        type="datetime-local" 
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="w-full text-sm text-gray-700 outline-none border-b border-gray-100 pb-2" 
                      />
                    </div>
                    <div className="space-y-3 mb-4">
                      {['Tomorrow', 'Tomorrow, 10:00 AM', 'Tomorrow, 11:00 AM', 'Tomorrow, 3:00 PM'].map(t => (
                        <div key={t} className="text-xs text-gray-500 font-medium hover:text-gray-900 cursor-pointer">{t}</div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                      <button onClick={() => setShowScheduleDropdown(false)} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Cancel</button>
                      <button onClick={() => setShowScheduleDropdown(false)} className="px-4 py-1.5 rounded-full border border-[#22C55E] text-[#22C55E] text-xs font-semibold">Done</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Compose Form */}
              <div className="flex-1 overflow-y-auto px-12 py-8 max-w-5xl">
                
                <div className="space-y-0">
                  <div className="flex items-center py-4 border-b border-gray-100">
                    <span className="w-24 text-[13px] font-bold text-gray-700 shrink-0">From</span>
                    <div className="flex items-center gap-2 bg-gray-50/80 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors">
                      {user?.email} <ChevronDown size={14} className="text-gray-400 ml-1" />
                    </div>
                  </div>
                  
                  <div className="flex items-center py-4 border-b border-gray-100">
                    <span className="w-24 text-[13px] font-bold text-gray-700 shrink-0 mt-2 self-start">To</span>
                    <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0 bg-transparent rounded-lg border border-transparent focus-within:border-gray-200 p-1 transition-colors max-h-32 overflow-y-auto">
                      {recipients.map((r, i) => (
                        <span key={i} className="px-2.5 py-1 bg-white border border-[#22C55E] text-[#22C55E] rounded-full text-xs font-semibold shrink-0 flex items-center gap-1.5">
                          {r}
                          <X 
                            size={12} 
                            className="cursor-pointer hover:text-red-500 opacity-70 hover:opacity-100" 
                            onClick={() => {
                              const newRecipients = recipients.filter(email => email !== r);
                              setRecipients(newRecipients);
                              if (newRecipients.length === 0 && !recipientText) setUploadedFileCount(null);
                            }}
                          />
                        </span>
                      ))}
                      <input 
                        type="text" 
                        placeholder={recipients.length === 0 ? "recipient@example.com (press Enter)" : ""} 
                        className="flex-1 min-w-[200px] outline-none text-[13px] font-medium text-gray-700 bg-transparent placeholder-gray-300 py-1"
                        value={recipientText}
                        onChange={(e) => setRecipientText(e.target.value)}
                        onBlur={() => {
                          addRecipient(recipientText);
                          setRecipientText('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            addRecipient(recipientText);
                            setRecipientText('');
                          } else if (e.key === 'Backspace' && !recipientText && recipients.length > 0) {
                            const newRecipients = recipients.slice(0, -1);
                            setRecipients(newRecipients);
                            if (newRecipients.length === 0) setUploadedFileCount(null);
                          }
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-4">
                      <label className="flex items-center gap-1.5 text-[#22C55E] text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity">
                        <Upload size={14} /> Upload List
                        <input type="file" ref={fileInputRef} accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
                      </label>
                      {uploadedFileCount !== null && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] font-medium text-gray-500">
                            {uploadedFileCount} email addresses detected
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center py-4 border-b border-gray-100">
                    <span className="w-24 text-[13px] font-bold text-gray-700 shrink-0">Subject</span>
                    <input 
                      type="text" 
                      placeholder="Subject" 
                      className="flex-1 outline-none text-[13px] text-gray-700 placeholder-gray-300 font-semibold" 
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center py-4 border-b border-gray-100 gap-8">
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-bold text-gray-700">Delay between emails</span>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="0"
                          className="w-16 h-8 border border-gray-200 rounded-lg text-center outline-none focus:border-green-400 text-xs font-semibold text-gray-700"
                          value={delayBetween}
                          onChange={(e) => setDelayBetween(e.target.value)}
                        />
                        <select 
                          className="h-8 border border-gray-200 rounded-lg px-2 outline-none focus:border-green-400 text-xs font-semibold text-gray-700 bg-white cursor-pointer"
                          value={delayUnit}
                          onChange={(e) => setDelayUnit(e.target.value)}
                        >
                          <option value="Seconds">Seconds</option>
                          <option value="Minutes">Minutes</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-bold text-gray-700">Hourly limit</span>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="1"
                          className="w-16 h-8 border border-gray-200 rounded-lg text-center outline-none focus:border-green-400 text-xs font-semibold text-gray-700" 
                          value={hourlyLimit}
                          onChange={(e) => setHourlyLimit(e.target.value)}
                        />
                        <span className="text-[13px] font-medium text-gray-500">emails/hour</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Editor Area */}
                <div className="mt-8 border border-gray-100 rounded-2xl overflow-hidden bg-[#FAFAFA] flex flex-col min-h-[450px]">
                  <div id="toolbar" className="px-6 py-3 border-b border-gray-100 bg-white flex items-center gap-3 overflow-x-auto text-gray-400">
                    <button className="ql-undo hover:text-gray-600"><Undo size={16} /></button>
                    <button className="ql-redo hover:text-gray-600"><Redo size={16} /></button>
                    <div className="w-px h-4 bg-gray-200 mx-2" />
                    <button className="ql-header hover:text-gray-600" value="1"><Type size={16} /></button>
                    <div className="w-px h-4 bg-gray-200 mx-2" />
                    <button className="ql-bold hover:text-gray-600 text-gray-700"><Bold size={16} /></button>
                    <button className="ql-italic hover:text-gray-600"><Italic size={16} /></button>
                    <button className="ql-underline hover:text-gray-600"><Underline size={16} /></button>
                    <div className="w-px h-4 bg-gray-200 mx-2" />
                    <button className="ql-list hover:text-gray-600" value="ordered"><ListOrdered size={16} /></button>
                    <button className="ql-list hover:text-gray-600" value="bullet"><List size={16} /></button>
                    <button className="ql-indent hover:text-gray-600" value="-1"><Indent size={16} className="rotate-180" /></button>
                    <button className="ql-indent hover:text-gray-600" value="+1"><Indent size={16} /></button>
                    <button className="ql-blockquote hover:text-gray-600"><Quote size={16} /></button>
                    <button className="ql-link hover:text-gray-600"><Link size={16} /></button>
                    <button className="ql-strike hover:text-gray-600"><Strikethrough size={16} /></button>
                  </div>
                  <div className="flex-1 overflow-hidden relative quill-wrapper">
                    <div 
                      ref={editorRef}
                      className="absolute inset-0 h-full w-full [&_.ql-container]:!border-none [&_.ql-container]:!text-sm [&_.ql-editor]:!p-6 [&_.ql-editor]:!text-gray-700 [&_.ql-editor.ql-blank::before]:!text-gray-300 [&_.ql-editor.ql-blank::before]:!font-medium [&_.ql-editor]:!font-medium"
                    />
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
