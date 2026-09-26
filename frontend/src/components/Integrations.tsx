import React, { useState, useEffect } from 'react';
import { slackApi } from '@/lib/api';
import { SlackStatus } from '@/types';
import { Loader2 } from 'lucide-react';

export default function Integrations() {
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchSlackStatus();
  }, []);

  // Check URL parameters for OAuth redirect callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slackParam = params.get('slack');
    
    if (slackParam === 'connected') {
      showToast('Slack connected successfully.', 'success');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchSlackStatus();
    } else if (slackParam === 'error') {
      const errorMsg = params.get('message') || 'Unable to connect Slack.';
      showToast(errorMsg, 'error');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchSlackStatus = async () => {
    try {
      setIsLoading(true);
      const status = await slackApi.getStatus();
      setSlackStatus(status);
    } catch (err) {
      console.error(err);
      showToast('Failed to load Slack status.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const handleConnect = () => {
    window.location.href = slackApi.getConnectUrl();
  };

  const handleTest = async () => {
    try {
      setIsTesting(true);
      await slackApi.test();
      showToast('Slack test notification sent successfully.', 'success');
    } catch (err) {
      showToast('Unable to send Slack test notification.', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Slack?\n\nReachSched will stop sending Slack notifications for this account.')) {
      return;
    }

    try {
      setIsDisconnecting(true);
      await slackApi.disconnect();
      await fetchSlackStatus();
      showToast('Slack disconnected successfully.', 'success');
    } catch (err) {
      showToast('Unable to disconnect Slack.', 'error');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in bg-[#FAFAFA] relative">
      {/* Toast */}
      {toast && (
        <div className={`absolute top-6 left-1/2 -translate-x-1/2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold z-50 transition-all ${toast.type === 'success' ? 'bg-[#E8F5E9] text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {toast.message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-12 py-10">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Integrations</h1>
          <p className="text-gray-500 mb-10 text-sm font-medium">Connect the tools you use with ReachSched.</p>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-6">
              <div className="flex items-start gap-5">
                <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-7 h-7">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
                    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521h-6.313A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.521-2.521h6.313z" fill="#36C5F0"/>
                    <path d="M18.956 8.835a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.835a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.835zM17.688 8.835a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.313z" fill="#2EB67D"/>
                    <path d="M15.165 18.958a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.523-2.52v-2.522h2.523zM15.165 17.687a2.527 2.527 0 0 1-2.523-2.523 2.526 2.526 0 0 1 2.523-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522-2.523h-6.313z" fill="#ECB22E"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Slack</h3>
                  <p className="text-[13px] text-gray-500 mt-1 max-w-sm font-medium leading-relaxed">
                    Get notified when your email sending hourly limit is reached.
                  </p>
                </div>
              </div>
              
              <div className="shrink-0 mt-1 sm:mt-0">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm font-medium">
                    <Loader2 className="animate-spin" size={16} />
                    Checking connection...
                  </div>
                ) : slackStatus?.connected ? (
                  <div className="flex items-center gap-2 bg-[#E8F5E9] text-[#22C55E] px-3 py-1.5 rounded-full text-xs font-bold">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></div>
                    Connected
                  </div>
                ) : (
                  <div className="text-sm font-semibold text-gray-400 px-3 py-1.5">
                    Not connected
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 border-t border-gray-100 pt-8">
              {!isLoading && (
                slackStatus?.connected ? (
                  <div className="space-y-8">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                      <div>
                        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Workspace</div>
                        <div className="text-[15px] font-semibold text-gray-900">{slackStatus.teamName}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Channel</div>
                        <div className="text-[15px] font-semibold text-gray-900">{slackStatus.channelName}</div>
                      </div>
                      <div className="hidden md:block">
                        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Connected</div>
                        <div className="text-[15px] font-semibold text-gray-900">
                          {slackStatus.connectedAt ? new Date(slackStatus.connectedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={handleTest}
                        disabled={isTesting}
                        className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl border border-gray-200 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                      >
                        {isTesting && <Loader2 className="animate-spin" size={14} />}
                        {isTesting ? 'Testing...' : 'Test connection'}
                      </button>
                      <button 
                        onClick={handleDisconnect}
                        disabled={isDisconnecting}
                        className="px-5 py-2.5 bg-white hover:bg-red-50 text-red-600 text-sm font-semibold rounded-xl border border-red-100 hover:border-red-200 transition-colors disabled:opacity-50 shadow-sm"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={handleConnect}
                    className="px-6 py-3 bg-[#22C55E] hover:bg-green-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
                  >
                    Connect Slack
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
