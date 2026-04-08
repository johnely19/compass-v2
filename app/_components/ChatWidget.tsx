'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../_lib/types';
import type { ChatTarget } from '../_lib/chat-target';
import { chatTargetPill, CHAT_TARGET_EVENT, CHAT_TARGET_CLEAR_EVENT } from '../_lib/chat-target';
import styles from './ChatWidget.module.css';

/**
 * Lightweight markdown→HTML for chat messages.
 */
function renderMarkdown(text: string): string {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
  return html;
}

const TOOL_LABELS: Record<string, string> = {
  'web-search': '🔍 Searching the web…',
  'lookup-place': '📍 Looking up a place…',
  'save-discovery': '💾 Saving discovery…',
  'add-to-compass': '🧭 Adding to your Compass…',
  'edit-discovery': '✏️ Updating a place…',
  'remove-discovery': '🗑️ Removing a place…',
  'update-trip': '✈️ Updating trip…',
  'create-context': '📋 Creating context…',
};

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatWidget() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);

  // Active context key — synced from homepage
  const activeContextKeyRef = useRef<string | null>(null);

  // Chat target — card/section-level targeting
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const chatTargetRef = useRef<ChatTarget | null>(null);

  const createContextUsed = useRef(false);
  const updateTripUsed = useRef<string | null>(null);
  const preContextKeys = useRef<Set<string>>(new Set());
  const preContextSnapshots = useRef<Record<string, { dates?: string; city?: string; focus?: string[] }>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Listen for context switches from homepage
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail?.key) {
        activeContextKeyRef.current = detail.key;
      }
    };
    window.addEventListener('compass-context-switched', handler);
    return () => window.removeEventListener('compass-context-switched', handler);
  }, []);

  // Listen for 'new trip' from context switcher — prefill chat with trip prompt
  useEffect(() => {
    const handler = () => {
      setInput('Plan a new trip to ');
      setChatExpanded(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    };
    window.addEventListener('compass-new-trip', handler);
    return () => window.removeEventListener('compass-new-trip', handler);
  }, []);

  // Listen for prefill-chat events from empty state prompts
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (detail?.text) {
        setInput(detail.text);
        setChatExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };
    window.addEventListener('compass-prefill-chat', handler);
    return () => window.removeEventListener('compass-prefill-chat', handler);
  }, []);

  // Listen for chat target events (card-level targeting)
  useEffect(() => {
    const handleTarget = (e: Event) => {
      const target = (e as CustomEvent<ChatTarget>).detail;
      if (target) {
        setChatTarget(target);
        chatTargetRef.current = target;
        // Also set the context key
        activeContextKeyRef.current = target.contextKey;
        // Expand chat and focus input
        setChatExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };
    const handleClear = () => {
      setChatTarget(null);
      chatTargetRef.current = null;
    };
    window.addEventListener(CHAT_TARGET_EVENT, handleTarget);
    window.addEventListener(CHAT_TARGET_CLEAR_EVENT, handleClear);
    return () => {
      window.removeEventListener(CHAT_TARGET_EVENT, handleTarget);
      window.removeEventListener(CHAT_TARGET_CLEAR_EVENT, handleClear);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolStatus]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const processStream = useCallback(async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.content) {
              accumulated += parsed.content;
              setStreamContent(accumulated);
              setToolStatus(null);
            }

            if (parsed.tool) {
              const label = TOOL_LABELS[parsed.tool] || `⚙️ Using ${parsed.tool}…`;
              setToolStatus(label);
              if (parsed.tool === 'create-context') {
                createContextUsed.current = true;
              }
              if (parsed.tool === 'update-trip') {
                updateTripUsed.current = '__any__';
              }
            }

            if (parsed.toolResult && typeof window !== 'undefined') {
              if (['add-to-compass', 'save-discovery', 'edit-discovery', 'remove-discovery'].includes(parsed.toolResult)) {
                window.dispatchEvent(new CustomEvent('compass-data-changed'));
              }
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return accumulated;
  }, []);

  function clearChatTarget() {
    setChatTarget(null);
    chatTargetRef.current = null;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading || streaming) return;

    setError(null);
    setLoading(true);
    setStreamContent('');
    setToolStatus(null);
    createContextUsed.current = false;
    updateTripUsed.current = null;

    // Expand chat area on send
    if (!chatExpanded) setChatExpanded(true);

    // Snapshot contexts
    fetch('/api/contexts')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.contexts) {
          const ctxs = data.contexts as Array<{ key: string; dates?: string; city?: string; focus?: string[] }>;
          preContextKeys.current = new Set(ctxs.map(c => c.key));
          const snapshots: Record<string, { dates?: string; city?: string; focus?: string[] }> = {};
          for (const c of ctxs) {
            snapshots[c.key] = { dates: c.dates, city: c.city, focus: c.focus };
          }
          preContextSnapshots.current = snapshots;
        }
      })
      .catch(() => {});

    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    abortRef.current = new AbortController();

    // Build request body with chat target context
    const currentTarget = chatTargetRef.current;
    const requestBody: Record<string, unknown> = {
      message: trimmed,
      history: messages,
      contextKey: activeContextKeyRef.current,
    };

    // Add card-level targeting if active
    if (currentTarget?.card) {
      requestBody.chatTarget = {
        cardId: currentTarget.card.id,
        cardName: currentTarget.card.name,
        cardType: currentTarget.card.type,
        cardPlaceId: currentTarget.card.placeId,
      };
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        setLoading(false);
        setStreaming(true);

        const fullReply = await processStream(res);

        if (fullReply) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: fullReply,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        const hasEmergenceEvents = createContextUsed.current || updateTripUsed.current;
        if (typeof window !== 'undefined' && !hasEmergenceEvents) {
          window.dispatchEvent(new CustomEvent('compass-data-changed'));
        }

        if (hasEmergenceEvents && typeof window !== 'undefined') {
          setTimeout(async () => {
            try {
              const res = await fetch('/api/contexts');
              if (res.ok) {
                const data = await res.json();
                const allCtxs = data.contexts as Array<{ key: string; label: string; type: string; emoji: string; dates?: string; city?: string; focus?: string[] }>;

                const newCtxs = allCtxs.filter(c => !preContextKeys.current.has(c.key));
                for (const ctx of newCtxs) {
                  window.dispatchEvent(new CustomEvent('compass-trip-created', {
                    detail: { key: ctx.key, label: ctx.label, type: ctx.type, emoji: ctx.emoji },
                  }));
                  // Signal the homepage to switch to the new context
                  window.dispatchEvent(new CustomEvent('compass-chat-context-switch', {
                    detail: { key: ctx.key },
                  }));
                }

                if (updateTripUsed.current) {
                  for (const ctx of allCtxs) {
                    const prev = preContextSnapshots.current[ctx.key];
                    if (!prev) continue;
                    const changedAttrs: Array<{ field: string; value: string }> = [];
                    if (ctx.dates && ctx.dates !== prev.dates) {
                      changedAttrs.push({ field: 'dates', value: ctx.dates });
                    }
                    if (ctx.city && ctx.city !== prev.city) {
                      changedAttrs.push({ field: 'city', value: ctx.city });
                    }
                    const newFocus = (ctx.focus ?? []).filter(f => !(prev.focus ?? []).includes(f));
                    if (newFocus.length > 0) {
                      changedAttrs.push({ field: 'focus', value: newFocus.join(', ') });
                    }
                    if (changedAttrs.length > 0) {
                      window.dispatchEvent(new CustomEvent('compass-trip-attributes', {
                        detail: { key: ctx.key, attributes: changedAttrs },
                      }));
                    }
                  }
                }
              }
            } catch {
              // non-critical
            }
            window.dispatchEvent(new CustomEvent('compass-data-changed'));
          }, 800);
        }

        setStreamContent('');
        setStreaming(false);
        setToolStatus(null);
      } else {
        const data = await res.json();
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: data.reply,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('compass-data-changed'));
        }
        setLoading(false);
      }

    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // User cancelled
      } else {
        console.error('[chat] Send failed:', e);
        setError('Failed to send. Try again?');
      }
      setLoading(false);
      setStreaming(false);
      setStreamContent('');
      setToolStatus(null);
    } finally {
      abortRef.current = null;
    }
  }

  // Compute target pill display
  const targetPill = chatTarget ? chatTargetPill(chatTarget) : null;

  return (
    <div className={`${styles.chatPinned} ${chatExpanded ? styles.chatPinnedExpanded : ''}`}>
      {/* Messages area — only visible when expanded */}
      {chatExpanded && (
        <div className={styles.chatMessagesArea}>
          <div className={styles.chatMessages}>
            {messages.length === 0 && !loading && !streaming && (
              <div className={styles.chatEmpty}>
                <div className={styles.chatEmptyIcon}>🧭</div>
                <div className={styles.chatEmptyTitle}>Hey! I&apos;m your Compass Concierge.</div>
                <div className={styles.chatEmptyText}>
                  Ask me anything about restaurants, places to visit, or help planning your next trip.
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`${styles.chatMessage} ${
                  msg.role === 'user' ? styles.chatMessageUser : styles.chatMessageAssistant
                }`}
              >
                <div
                  className={`${styles.chatBubble} ${
                    msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div
                      className={styles.chatMarkdown}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  ) : (
                    <div className={styles.chatMarkdown}>{msg.content}</div>
                  )}
                </div>
                <span className={styles.chatTimestamp}>{formatTime(msg.timestamp)}</span>
              </div>
            ))}

            {streaming && streamContent && (
              <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
                <div className={`${styles.chatBubble} ${styles.chatBubbleAssistant}`}>
                  <div
                    className={styles.chatMarkdown}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(streamContent) }}
                  />
                  <span className={styles.chatStreamCursor} />
                </div>
              </div>
            )}

            {toolStatus && (
              <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
                <div className={styles.chatToolStatus}>{toolStatus}</div>
              </div>
            )}

            {loading && (
              <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
                <div className={styles.chatTyping}>
                  <span className={styles.chatTypingDot} />
                  <span className={styles.chatTypingDot} />
                  <span className={styles.chatTypingDot} />
                </div>
              </div>
            )}

            {error && (
              <div className={styles.chatError}>{error}</div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Target pill — shows what chat is scoped to */}
      {targetPill && (
        <div className={styles.chatTargetBar}>
          <div className={styles.chatTargetPill}>
            <span className={styles.chatTargetEmoji}>{targetPill.emoji}</span>
            <span className={styles.chatTargetLabel}>Chatting about <strong>{targetPill.label}</strong></span>
            <button
              type="button"
              className={styles.chatTargetClear}
              onClick={clearChatTarget}
              aria-label="Clear chat target"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Input area — always visible, pinned to bottom */}
      <div className={styles.chatInputBar}>
        {chatExpanded && (
          <button
            type="button"
            className={styles.chatMinimizeBtn}
            onClick={() => setChatExpanded(false)}
            aria-label="Minimize chat"
          >
            ▾
          </button>
        )}
        <form className={styles.chatInputForm} onSubmit={handleSend}>
          <textarea
            ref={inputRef}
            className={styles.chatInputField}
            placeholder={chatTarget?.card ? `Ask about ${chatTarget.card.name}…` : 'Ask me anything…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e as unknown as React.FormEvent);
              }
            }}
            onFocus={() => {
              if (messages.length > 0 && !chatExpanded) setChatExpanded(true);
            }}
            disabled={loading || streaming}
            rows={1}
          />
          <button
            type="submit"
            className={styles.chatSendButton}
            disabled={loading || streaming || !input.trim()}
          >
            ➤
          </button>
        </form>
      </div>
    </div>
  );
}
