'use client';

/**
 * SocialMediaInbox.tsx — Embedded inbox for Marketing tab
 *
 * এই component টা /admin/marketing?tab=inbox এ use হয়।
 * Full-screen version: SocialMediaInboxChat.tsx (/admin/inbox)
 *
 * Updates:
 *  - Unlimited Facebook sync (সব conversation, 25 limit নেই)
 *  - Real-time SSE adaptive polling (500ms when active)
 *  - Browser notifications support
 *  - Page title unread badge
 *  - New message sound + banner
 *  - "Open Full Inbox" button → /admin/inbox (new tab)
 *  - Sync progress bar with conversation count
 */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fixEncoding } from '@/lib/fixEncoding';
import { useInboxSocket, type InboxWsEvent } from '@/hooks/useInboxSocket';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle,
  ExternalLink,
  FileAudio,
  FileText,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  UserCircle,
  Video as VideoIcon,
  X,
  Zap,
} from 'lucide-react';

export interface SocialMessage {
  id: string;
  externalId?: string;
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'youtube';
  type: 'comment' | 'message' | 'dm' | 'mention';
  conversationId: string;
  sender: {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
    phone?: string;
  };
  content: {
    text: string;
    media?: Array<{
      type: 'image' | 'video' | 'audio' | 'document' | 'file';
      url: string;
      thumbnail?: string;
      fileName?: string;
      mimeType?: string;
    }>;
  };
  post?: { id: string; text: string; media?: string };
  status: 'unread' | 'read' | 'replied' | 'archived';
  timestamp: string;
  isIncoming: boolean;
}

interface SocialMediaInboxProps {
  className?: string;
  initialPlatform?: 'all' | SocialMessage['platform'];
  title?: string;
  description?: string;
}

interface SocialMessageApiRecord {
  id: string;
  externalId?: string | null;
  platform: SocialMessage['platform'];
  type: SocialMessage['type'];
  conversationId?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderAvatar?: string | null;
  content: string;
  isRead: boolean;
  timestamp: string;
  isIncoming: boolean;
  attachments?: Array<{
    id: string;
    type: string;
    mimeType?: string | null;
    fileName?: string | null;
    storageUrl?: string | null;
    externalUrl?: string | null;
    thumbnailUrl?: string | null;
  }>;
}

interface SocialConversationSummary {
  conversationId: string;
  platform: SocialMessage['platform'];
  participant: SocialMessage['sender'];
  latestMessage: SocialMessage;
  unreadCount: number;
}

interface DraftAttachment {
  id: string;
  file: File;
  previewUrl: string;
  type: SocialMediaContentItem['type'];
}

interface FacebookSyncProgressState {
  stage: 'idle' | 'starting' | 'fetching' | 'processing_conversation' | 'processing_message' | 'completed' | 'error';
  processedConversations: number;
  totalConversations: number;
  processedMessages: number;
  processedAttachments: number;
  conversationId?: string;
  senderName?: string | null;
  error?: string;
}

type SocialMediaContentItem = NonNullable<SocialMessage['content']['media']>[number];

// ── helpers ──

function normalizeMediaType(type: string): SocialMediaContentItem['type'] {
  if (type === 'image' || type === 'video' || type === 'audio' || type === 'document') return type;
  return 'file';
}

function mapApiMessage(m: SocialMessageApiRecord): SocialMessage {
  return {
    id: m.id,
    externalId: m.externalId || undefined,
    platform: m.platform,
    type: m.type,
    conversationId: m.conversationId || (m.senderId ? `${m.platform}:${m.senderId}` : m.id),
    sender: {
      id: m.senderId || 'unknown',
      name: m.senderName || (m.isIncoming ? 'Facebook user' : 'Minsah Beauty'),
      avatar: m.senderAvatar ?? undefined,
    },
    content: {
      text: m.content,
      media: (m.attachments ?? [])
        .map((a): SocialMediaContentItem => ({
          type: normalizeMediaType(a.type),
          url: a.storageUrl || a.externalUrl || '',
          thumbnail: a.thumbnailUrl || undefined,
          fileName: a.fileName || undefined,
          mimeType: a.mimeType || undefined,
        }))
        .filter((a) => Boolean(a.url)),
    },
    status: m.isIncoming ? (m.isRead ? 'read' : 'unread') : 'replied',
    timestamp: m.timestamp,
    isIncoming: m.isIncoming,
  };
}

function formatConversationPreview(message: SocialMessage) {
  const prefix = message.isIncoming ? '' : 'You: ';
  const text = fixEncoding(message.content.text || '').trim();
  return `${prefix}${text || 'No message content'}`;
}

function inferDraftAttachmentType(file: File): SocialMediaContentItem['type'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

function formatConversationTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDayDivider(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function isSameDay(left: string, right: string) {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* ignore */ }
}

// ── platform icon ──

function PlatformIcon({ platform }: { platform: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    facebook:  { bg: '#1877f2', label: 'f' },
    instagram: { bg: 'linear-gradient(135deg,#833ab4,#e1306c)', label: 'ig' },
    whatsapp:  { bg: '#25d366', label: 'W' },
    youtube:   { bg: '#ff0000', label: 'YT' },
  };
  const cfg = map[platform] ?? map.facebook;
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 6,
      background: cfg.bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: 800, flexShrink: 0,
    }}>
      {cfg.label}
    </div>
  );
}

// ── main component ──

export default function SocialMediaInbox({
  className = '',
  initialPlatform = 'all',
  title = 'Social Inbox',
  description = 'Manage all social messages and comments',
}: SocialMediaInboxProps) {
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<string>(initialPlatform);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [syncingFacebook, setSyncingFacebook] = useState(false);
  const [syncProgress, setSyncProgress] = useState<FacebookSyncProgressState>({
    stage: 'idle', processedConversations: 0, totalConversations: 0,
    processedMessages: 0, processedAttachments: 0,
  });
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [newMessageBanner, setNewMessageBanner] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedConversation;

  // ── notifications ──
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotificationsEnabled(true);
    }
  }, []);

  const requestNotifications = useCallback(async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotificationsEnabled(perm === 'granted');
  }, []);

  // ── page title badge ──
  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) Minsah Inbox`;
    }
    return () => { document.title = 'Minsah Admin'; };
  }, [unreadCount]);

  // ── fetch + merge ──
  const fetchAndMergeMessages = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setInitialLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterPlatform !== 'all') params.set('platform', filterPlatform);
      const res = await fetch(`/api/social/messages${params.toString() ? `?${params}` : ''}`, { cache: 'no-store' });
      const data = (await res.json()) as { messages: SocialMessageApiRecord[]; unreadCount: number };
      const incoming = (data.messages || []).map(mapApiMessage);

      setMessages((prev) => {
        const serverIds = new Set(incoming.map((m) => m.id));
        const optimistic = prev.filter((m) => !serverIds.has(m.id) && !m.isIncoming);

        // Detect new messages
        const prevIds = new Set(prev.map((m) => m.id));
        const brandNew = incoming.filter((m) => m.isIncoming && !prevIds.has(m.id));
        if (brandNew.length > 0 && prev.length > 0) {
          playNotificationSound();
          const newest = brandNew[brandNew.length - 1];

          // Browser notification
          if (notificationsEnabled && document.visibilityState !== 'visible') {
            try {
              new Notification(`New message from ${newest.sender.name}`, {
                body: fixEncoding(newest.content.text).slice(0, 100),
                icon: newest.sender.avatar || '/favicon.ico',
                tag: 'minsah-inbox',
              });
            } catch { /* ignore */ }
          }

          if (selectedRef.current !== newest.conversationId) {
            setNewMessageBanner(`New message from ${newest.sender.name}`);
            setTimeout(() => setNewMessageBanner(null), 4000);
          }
        }

        return [...incoming, ...optimistic];
      });
      setUnreadCount(data.unreadCount || 0);
    } catch { /* silent */ }
    finally { setInitialLoading(false); }
  }, [filterPlatform, notificationsEnabled]);

  useEffect(() => {
    void fetchAndMergeMessages(true);
  }, [fetchAndMergeMessages]);

  const handleWsEvent = useCallback((event: InboxWsEvent) => {
    if (filterPlatform !== 'all' && filterPlatform !== 'facebook') return;
    if (event.type === 'pong' || event.type === 'connected') return;
    void fetchAndMergeMessages(false);
  }, [fetchAndMergeMessages, filterPlatform]);

  const { sendMarkRead } = useInboxSocket(handleWsEvent);

  // ── SSE real-time + adaptive reconnect ──
  useEffect(() => {
    void fetchAndMergeMessages(true);

    const streamUrl = '';

    let eventSource: EventSource | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectStream = () => {
      void streamUrl;
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchAndMergeMessages(false);
      }
    };

    connectStream();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      (eventSource as EventSource | null)?.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [filterPlatform, fetchAndMergeMessages]);

  // Auto-sync if empty
  useEffect(() => {
    if (!initialLoading && messages.length === 0 && filterPlatform === 'facebook') {
      void handleFacebookSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading]);

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, []);

  // ── Facebook sync (UNLIMITED) ──
  const handleFacebookSync = async () => {
    if (syncingFacebook) return;
    setSyncingFacebook(true);
    setSyncProgress({ stage: 'starting', processedConversations: 0, totalConversations: 0, processedMessages: 0, processedAttachments: 0 });
    try {
      await fetchAndMergeMessages(false);
      setSyncProgress((prev) => ({ ...prev, stage: 'completed' }));
    } catch (error) {
      setSyncProgress((prev) => ({
        ...prev,
        stage: 'error',
        error: error instanceof Error ? error.message : 'Refresh failed',
      }));
    } finally {
      setSyncingFacebook(false);
    }
  };

  const syncStatusLabel = useMemo(() => {
    switch (syncProgress.stage) {
      case 'starting': return 'Starting sync…';
      case 'fetching': return `Fetching conversations… (${syncProgress.totalConversations} found)`;
      case 'processing_conversation': return syncProgress.senderName ? `Processing: ${syncProgress.senderName}` : 'Processing…';
      case 'processing_message': return `Saving messages… (${syncProgress.processedMessages})`;
      case 'completed': return `✓ Synced ${syncProgress.processedConversations} conversations, ${syncProgress.processedMessages} messages`;
      case 'error': return `✕ ${syncProgress.error || 'Sync failed'}`;
      default: return null;
    }
  }, [syncProgress]);

  const syncPercent = useMemo(() => {
    if (!syncProgress.totalConversations) return 0;
    return Math.round((syncProgress.processedConversations / syncProgress.totalConversations) * 100);
  }, [syncProgress]);

  // ── conversations ──
  const filteredMessages = useMemo(() =>
    messages.filter((msg) => {
      if (filterPlatform !== 'all' && msg.platform !== filterPlatform) return false;
      if (filterStatus !== 'all' && msg.status !== filterStatus) return false;
      if (searchQuery && !fixEncoding(msg.content.text).toLowerCase().includes(searchQuery.toLowerCase()) && !msg.sender.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }),
    [filterPlatform, filterStatus, messages, searchQuery]
  );

  const conversationList = useMemo(() => {
    const grouped = new Map<string, SocialMessage[]>();
    for (const message of filteredMessages) {
      const key = message.conversationId || message.id;
      const items = grouped.get(key);
      if (items) { items.push(message); } else { grouped.set(key, [message]); }
    }
    return Array.from(grouped.entries())
      .map(([conversationId, items]): SocialConversationSummary => {
        const sorted = [...items].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const latestMessage = sorted[sorted.length - 1];
        const participant = [...sorted].reverse().find((m) => m.isIncoming)?.sender ?? sorted[0].sender;
        return {
          conversationId, platform: latestMessage.platform, participant, latestMessage,
          unreadCount: sorted.filter((m) => m.isIncoming && m.status === 'unread').length,
        };
      })
      .sort((a, b) => new Date(b.latestMessage.timestamp).getTime() - new Date(a.latestMessage.timestamp).getTime());
  }, [filteredMessages]);

  useEffect(() => {
    if (conversationList.length === 0) { if (selectedConversation) setSelectedConversation(null); return; }
    if (!conversationList.some((c) => c.conversationId === selectedConversation))
      setSelectedConversation(conversationList[0].conversationId);
  }, [conversationList, selectedConversation]);

  const selectedConversationSummary = useMemo(
    () => conversationList.find((c) => c.conversationId === selectedConversation) ?? null,
    [conversationList, selectedConversation]
  );

  useEffect(() => {
    if (selectedConversationSummary?.platform !== 'facebook' && draftAttachments.length > 0)
      clearDraftAttachments();
  }, [selectedConversationSummary?.platform, draftAttachments.length]); // eslint-disable-line

  useEffect(() => {
    if (selectedConversation) setShowThreadOnMobile(true);
  }, [selectedConversation]);

  const conversationMessages = useMemo(() =>
    selectedConversation
      ? filteredMessages.filter((m) => m.conversationId === selectedConversation).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      : [],
    [filteredMessages, selectedConversation]
  );

  const selectedParticipantMessage = useMemo(
    () => [...conversationMessages].reverse().find((m) => m.isIncoming) ?? conversationMessages[0] ?? null,
    [conversationMessages]
  );

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversationMessages.length, selectedConversation]);

  useEffect(() => {
    if (!selectedConversation) return;
    const hasUnread = messages.some((m) => m.conversationId === selectedConversation && m.isIncoming && m.status === 'unread');
    if (!hasUnread) return;
    setMessages((prev) => prev.map((m) => m.conversationId === selectedConversation && m.isIncoming ? { ...m, status: 'read' as const } : m));
    setUnreadCount((prev) => Math.max(0, prev - messages.filter((m) => m.conversationId === selectedConversation && m.isIncoming && m.status === 'unread').length));
    if (selectedConversationSummary?.platform === 'facebook') {
      sendMarkRead(selectedConversationSummary.participant.id, selectedConversation);
      return;
    }
    void fetch('/api/social/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedConversation, platform: filterPlatform !== 'all' ? filterPlatform : undefined }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation, selectedConversationSummary, filterPlatform, messages, sendMarkRead]);

  const clearDraftAttachments = useCallback(() => {
    setDraftAttachments((prev) => { prev.forEach((a) => URL.revokeObjectURL(a.previewUrl)); return []; });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeDraftAttachment = (id: string) => {
    setDraftAttachments((prev) => {
      const t = prev.find((a) => a.id === id);
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleDraftAttachmentChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const next = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/'))
      .map((f, i) => ({ id: `${f.name}-${Date.now()}-${i}`, file: f, previewUrl: URL.createObjectURL(f), type: inferDraftAttachmentType(f) }));
    setDraftAttachments((p) => [...p, ...next]);
    e.target.value = '';
  };

  const handleReply = async (conversationId: string) => {
    if ((!replyText.trim() && draftAttachments.length === 0) || sendingReply) return;
    const thread = messages.filter((m) => m.conversationId === conversationId).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const targetMessage = [...thread].reverse().find((m) => m.isIncoming) ?? thread[thread.length - 1];
    if (!targetMessage) return;
    if (targetMessage.platform !== 'facebook') {
      setReplyError('Realtime inbox migration currently supports Facebook only.');
      return;
    }
    if (draftAttachments.length > 0) {
      setReplyError('Attachment replies are not supported in the realtime inbox yet.');
      return;
    }

    setSendingReply(true);
    setReplyError(null);

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: SocialMessage = {
      id: optimisticId, platform: targetMessage.platform, type: targetMessage.type,
      conversationId, sender: { id: 'page', name: 'Minsah Beauty' },
      content: { text: replyText.trim() }, status: 'replied',
      timestamp: new Date().toISOString(), isIncoming: false,
    };
    const capturedText = replyText.trim();
    setMessages((prev) => [...prev, optimisticMessage]);
    setReplyText('');
    clearDraftAttachments();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const response = await fetch('/api/admin/inbox/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: targetMessage.type === 'comment' ? 'comment' : 'messenger',
          commentId: targetMessage.type === 'comment' ? targetMessage.externalId : undefined,
          recipientPsid:
            targetMessage.type === 'comment'
              ? undefined
              : selectedConversationSummary?.participant.id ?? targetMessage.sender.id,
          text: capturedText,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Reply failed');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      void fetchAndMergeMessages(false);
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setReplyText(capturedText);
      setReplyError(error instanceof Error ? error.message : 'Reply failed');
    } finally {
      setSendingReply(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (selectedConversationSummary) void handleReply(selectedConversationSummary.conversationId);
    }
  };

  const canAttachMedia = false;

  // ── render ──

  if (initialLoading) {
    return (
      <div className={`flex h-full items-center justify-center bg-white ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-500" />
          <p className="text-sm text-slate-500">Loading inbox…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden bg-gray-50 ${className}`}>

      {/* ── New message banner ── */}
      {newMessageBanner && (
        <div className="flex items-center gap-2 bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          <Zap className="h-4 w-4" />
          {newMessageBanner}
          <button onClick={() => setNewMessageBanner(null)} className="ml-auto text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Sync progress ── */}
      {syncingFacebook && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2">
          <div className="flex items-center justify-between gap-3 text-xs text-amber-800">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span className="font-medium">{syncStatusLabel}</span>
            </div>
            {syncProgress.totalConversations > 0 && (
              <span>{syncProgress.processedConversations}/{syncProgress.totalConversations}</span>
            )}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-amber-200">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-300"
              style={{ width: `${syncPercent || 5}%` }}
            />
          </div>
        </div>
      )}
      {!syncingFacebook && syncStatusLabel && (
        <div className={`px-4 py-2 text-xs font-medium ${
          syncProgress.stage === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
        }`}>
          {syncStatusLabel}
        </div>
      )}

      {/* ── Header ── */}
      <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">{description}</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className="rounded-full bg-blue-500 px-2.5 py-0.5 text-xs font-bold text-white">
                {unreadCount} unread
              </span>
            )}

            {/* Notification toggle */}
            <button
              onClick={() => notificationsEnabled ? setNotificationsEnabled(false) : void requestNotifications()}
              title={notificationsEnabled ? 'Notifications on' : 'Enable notifications'}
              className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                notificationsEnabled ? 'border-green-200 bg-green-50 text-green-600' : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600'
              }`}
            >
              {notificationsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>

            {/* Open full inbox */}
            <a
              href="/admin/inbox"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              title="Open full-screen inbox"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Full Inbox
            </a>

            {/* FB sync */}
            {(filterPlatform === 'facebook' || filterPlatform === 'all') && (
              <button
                onClick={() => void handleFacebookSync()}
                disabled={syncingFacebook}
                className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingFacebook ? 'animate-spin' : ''}`} />
                {syncingFacebook ? 'Refreshing…' : 'Refresh Inbox'}
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400">
            <option value="all">All Platforms</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="youtube">YouTube</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400">
            <option value="all">All Status</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
            <option value="replied">Replied</option>
          </select>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* Conversation list */}
        <div className={`${showThreadOnMobile ? 'hidden md:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-72 lg:w-80`}>
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Conversations</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {conversationList.length}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversationList.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-400">
                <MessageCircle className="h-10 w-10 opacity-40" />
                <p className="text-sm">
                  {filterPlatform === 'facebook' ? 'Click "Refresh Inbox" to load chats' : 'No conversations'}
                </p>
              </div>
            ) : (
              conversationList.map((conversation) => (
                <button
                  key={conversation.conversationId}
                  type="button"
                  onClick={() => { setSelectedConversation(conversation.conversationId); setShowThreadOnMobile(true); }}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition ${
                    selectedConversation === conversation.conversationId
                      ? 'border-l-2 border-l-blue-500 bg-blue-50'
                      : 'border-l-2 border-l-transparent hover:bg-slate-50'
                  }`}
                >
                  <div className="relative shrink-0">
                    {conversation.participant.avatar ? (
                      <img src={conversation.participant.avatar} alt={conversation.participant.name}
                        className="h-11 w-11 rounded-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <UserCircle className="h-11 w-11 text-slate-300" />
                    )}
                    <div className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white">
                      <PlatformIcon platform={conversation.platform} />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className={`truncate text-sm ${conversation.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}`}>
                        {conversation.participant.name}
                      </p>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatConversationTimestamp(conversation.latestMessage.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-xs ${conversation.unreadCount > 0 ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
                        {formatConversationPreview(conversation.latestMessage)}
                      </p>
                      {conversation.unreadCount > 0 && (
                        <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-bold text-white">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread panel */}
        <div className={`${!showThreadOnMobile ? 'hidden md:flex' : 'flex'} min-h-0 flex-1 flex-col bg-white`}>
          {selectedConversationSummary ? (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <button onClick={() => setShowThreadOnMobile(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 md:hidden">
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <div className="relative shrink-0">
                  {selectedConversationSummary.participant.avatar ? (
                    <img src={selectedConversationSummary.participant.avatar} alt={selectedConversationSummary.participant.name}
                      className="h-10 w-10 rounded-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <UserCircle className="h-10 w-10 text-slate-300" />
                  )}
                  <div className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white">
                    <PlatformIcon platform={selectedConversationSummary.platform} />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-slate-900">
                      {selectedConversationSummary.participant.name}
                    </h3>
                    {selectedConversationSummary.unreadCount > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        {selectedConversationSummary.unreadCount} unread
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 capitalize">{selectedConversationSummary.platform}</p>
                </div>

                {/* Open full inbox shortcut */}
                <a href="/admin/inbox" target="_blank" rel="noreferrer"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition hover:text-slate-600"
                  title="Open in full inbox">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {/* Messages */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
                <div className="mx-auto flex max-w-2xl flex-col gap-2">
                  {conversationMessages.map((message, index) => {
                    const prev = conversationMessages[index - 1];
                    const next = conversationMessages[index + 1];
                    const showDayDivider = !prev || !isSameDay(prev.timestamp, message.timestamp);
                    const showAvatar = message.isIncoming && (!next || !next.isIncoming || next.sender.id !== message.sender.id);
                    const isOptimistic = message.id.startsWith('optimistic-');

                    return (
                      <div key={message.id} className={isOptimistic ? 'opacity-60' : ''}>
                        {showDayDivider && (
                          <div className="my-3 flex items-center justify-center">
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm ring-1 ring-slate-200">
                              {formatDayDivider(message.timestamp)}
                            </span>
                          </div>
                        )}

                        <div className={`flex ${message.isIncoming ? 'justify-start' : 'justify-end'}`}>
                          <div className={`flex max-w-[80%] items-end gap-2 ${message.isIncoming ? '' : 'flex-row-reverse'}`}>
                            <div className="w-7 shrink-0">
                              {showAvatar && (
                                message.sender.avatar
                                  ? <img src={message.sender.avatar} alt={message.sender.name} className="h-7 w-7 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  : <UserCircle className="h-7 w-7 text-slate-300" />
                              )}
                            </div>

                            <div className={message.isIncoming ? '' : 'text-right'}>
                              <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                                message.isIncoming
                                  ? 'rounded-bl-sm bg-white text-slate-900 ring-1 ring-slate-200'
                                  : 'rounded-br-sm bg-blue-600 text-white'
                              }`}>
                                <p className="whitespace-pre-wrap">{fixEncoding(message.content.text)}</p>
                                {message.content.media && message.content.media.length > 0 && (
                                  <div className="mt-2 grid gap-2">
                                    {message.content.media.map((media, mi) => renderMediaAttachment(media, `${message.id}-${mi}`, message.isIncoming))}
                                  </div>
                                )}
                              </div>
                              <p className="mt-1 px-1 text-[11px] text-slate-400">
                                {new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                {!message.isIncoming && (
                                  <span className="ml-1">
                                    <CheckCircle className="inline h-3 w-3 text-green-400" />
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messageEndRef} />
                </div>
              </div>

              {/* Reply box */}
              <div className="border-t border-slate-100 bg-white px-4 py-3">
                {replyError && (
                  <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{replyError}</p>
                )}
                {draftAttachments.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {draftAttachments.map((attachment) => (
                      <div key={attachment.id} className="relative w-20 overflow-hidden rounded-xl border border-slate-200">
                        <button onClick={() => removeDraftAttachment(attachment.id)}
                          className="absolute right-1 top-1 z-10 rounded-full bg-black/70 p-0.5 text-white">
                          <X className="h-3 w-3" />
                        </button>
                        <div className="flex h-16 items-center justify-center bg-slate-100">
                          {attachment.type === 'image' ? (
                            <img src={attachment.previewUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <FileAudio className="h-6 w-6 text-slate-400" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!canAttachMedia && (
                  <p className="mb-2 text-[11px] text-slate-400">Attachment replies are currently unavailable in the realtime inbox.</p>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={handleDraftAttachmentChange} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={!canAttachMedia || sendingReply}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition hover:text-slate-700 disabled:opacity-40">
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <textarea ref={textareaRef} value={replyText}
                    onChange={(e) => { setReplyText(e.target.value); autoResizeTextarea(); }}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Write a reply… (Enter to send)"
                    rows={1}
                    className="max-h-28 min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                  <button
                    onClick={() => selectedConversationSummary && void handleReply(selectedConversationSummary.conversationId)}
                    disabled={(!replyText.trim() && draftAttachments.length === 0) || sendingReply}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-40">
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <MessageCircle className="mx-auto mb-3 h-12 w-12 text-slate-200" />
                <p className="text-sm text-slate-400">Select a conversation to view messages</p>
                {filterPlatform === 'facebook' && (
                  <button onClick={() => void handleFacebookSync()}
                    className="mt-4 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 mx-auto">
                    <RefreshCw className="h-4 w-4" />
                    Refresh Facebook Inbox
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── media renderer ──
function renderMediaAttachment(
  media: NonNullable<SocialMessage['content']['media']>[number],
  key: string,
  isIncoming: boolean
) {
  if (media.type === 'image') {
    return (
      <a key={key} href={media.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
        <img src={media.thumbnail || media.url} alt={media.fileName || 'Image'} className="max-h-48 w-full object-cover" />
      </a>
    );
  }
  if (media.type === 'video') {
    return (
      <div key={key} className="overflow-hidden rounded-xl bg-black">
        <video controls preload="metadata" poster={media.thumbnail} className="max-h-48 w-full" src={media.url} />
        {media.fileName && (
          <div className={`flex items-center gap-1.5 px-2 py-1 text-xs ${isIncoming ? 'text-slate-500' : 'text-white/70'}`}>
            <VideoIcon className="h-3 w-3" /><span className="truncate">{media.fileName}</span>
          </div>
        )}
      </div>
    );
  }
  if (media.type === 'audio') {
    return (
      <div key={key} className="rounded-xl border border-slate-200 p-2">
        <div className={`mb-1 flex items-center gap-1.5 text-xs ${isIncoming ? 'text-slate-500' : 'text-white/70'}`}>
          <FileAudio className="h-3 w-3" /><span className="truncate">{media.fileName || 'Audio'}</span>
        </div>
        <audio controls preload="metadata" className="h-8 w-full" src={media.url} />
      </div>
    );
  }
  return (
    <a key={key} href={media.url} target="_blank" rel="noreferrer"
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${isIncoming ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-white/20 text-white/80 hover:bg-white/10'}`}>
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{media.fileName || media.mimeType || 'File'}</span>
    </a>
  );
}
