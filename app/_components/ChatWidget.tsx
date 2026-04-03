'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../_lib/types';
import styles from './ChatWidget.module.css';

/**
 * Lightweight markdown→HTML for chat messages.
 * Handles: links, bold, italic, inline code, line breaks.
 */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Bare URLs
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks
    .replace(/\n/g, '<br/>');

  return html;
}

/** Friendly labels for tool calls */
const TOOL_LABELS: Record<string, string> = {
  'web-search': '🔍 Searching the web…',
  'lookup-place': '📍 Looking up a place…',
  'save-discovery': '💾 Saving discovery…',
  'add-to-compass': '🧭 Adding to your Compass…',
  'update-trip': '✈️ Updating trip…',
  'create-context': '📋 Creating context…',
};

/** Format timestamp for display */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Get last message preview text */
function getLastMessagePreview(messages: ChatMessage[]): string | null {
  if (messages.length === 0) return null;
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return null;
  const preview = lastMsg.content.substring(0, 50);
  return preview + (lastMsg.content.length > 50 ? '...' : '');
}

/** Check if there was recent activity (within 5 minutes) */
function hasRecentActivity(messages: ChatMessage[]): boolean {
  if (messages.length === 0) return false;
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return false;
  const lastMsgTime = new Date(lastMsg.timestamp).getTime();
  const now = Date.now();
  return now - lastMsgTime < 5 * 60 * 1000;
}

export default function ChatWidget() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justExpanded, setJustExpanded] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const collapsedInputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragStartY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  // Load persisted state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat-widget-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.isExpanded) {
          setIsExpanded(true);
          setJustExpanded(true);
          setTimeout(() => setJustExpanded(false), 400);
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  // Load chat history on first expand
  useEffect(() => {
    if (isExpanded && messages.length === 0) {
      loadChatHistory();
    }
  }, [isExpanded]);

  // Check for auto-expand on new messages
  useEffect(() => {
    if (messages.length > 0 && !isExpanded) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        // Auto-expand on new incoming message
        handleExpand(true);
        setAutoExpanded(true);
        setTimeout(() => setAutoExpanded(false), 600);
      }
    }
  }, [messages]);

  // Check for recent activity to auto-expand on mount
  useEffect(() => {
    if (messages.length > 0 && hasRecentActivity(messages) && !isExpanded) {
      handleExpand(true);
      setAutoExpanded(true);
      setTimeout(() => setAutoExpanded(false), 600);
    }
  }, []);

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolStatus, isExpanded]);

  // Focus input when expanding
  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => expandedInputRef.current?.focus(), 100);
    }
  }, [isExpanded]);

  // Save state to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('chat-widget-state', JSON.stringify({ isExpanded }));
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [isExpanded]);

  function handleExpand(expanded: boolean) {
    setIsExpanded(expanded);
    if (expanded) {
      setJustExpanded(true);
      setTimeout(() => setJustExpanded(false), 400);
    }
  }

  function handleToggle() {
    handleExpand(!isExpanded);
  }

  function handleDragStart(e: React.MouseEvent | React.TouchEvent) {
    isDragging.current = true;
    if ('touches' in e && e.touches && e.touches[0]) {
      dragStartY.current = e.touches[0].clientY;
    } else if ('clientY' in e) {
      dragStartY.current = e.clientY;
    }
  }

  function handleDragMove(e: React.MouseEvent | React.TouchEvent) {
    if (!isDragging.current) return;
    let currentY: number;
    if ('touches' in e && e.touches && e.touches[0]) {
      currentY = e.touches[0].clientY;
    } else if ('clientY' in e) {
      currentY = e.clientY;
    } else {
      return;
    }
    const diff = currentY - dragStartY.current;
    if (diff > 50) {
      // Dragged down enough to collapse
      handleExpand(false);
      isDragging.current = false;
    }
  }

  function handleDragEnd() {
    isDragging.current = false;
  }

  async function loadChatHistory() {
    try {
      const res = await fetch('/api/chat/history');
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
        }
      }
    } catch (e) {
      console.error('[chat] Failed to load history:', e);
    }
  }

  /**
   * Process an SSE stream from the chat API.
   */
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

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.content) {
              accumulated += parsed.content;
              setStreamContent(accumulated);
              setToolStatus(null); // clear tool status when content starts flowing
            }

            if (parsed.tool) {
              const label = TOOL_LABELS[parsed.tool] || `⚙️ Using ${parsed.tool}…`;
              setToolStatus(label);
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading || streaming) return;

    setError(null);
    setLoading(true);
    setStreamContent('');
    setToolStatus(null);

    // Expand if collapsed when sending
    if (!isExpanded) {
      handleExpand(true);
    }

    // Add user message immediately
    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Create abort controller for this request
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: messages,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // Streaming response
        setLoading(false);
        setStreaming(true);

        const fullReply = await processStream(res);

        // Add completed message to history
        if (fullReply) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: fullReply,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        setStreamContent('');
        setStreaming(false);
        setToolStatus(null);
      } else {
        // Non-streaming JSON response (fallback)
        const data = await res.json();
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: data.reply,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setLoading(false);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // User cancelled — no error
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

  const lastPreview = getLastMessagePreview(messages);

  // Render collapsed state
  if (!isExpanded) {
    return (
      <div className={styles.chatRoot}>
        <div className={styles.chatCollapsed}>
          {/* Input section */}
          <div
            className={styles.chatCollapsedInput}
            onClick={(e) => {
              e.stopPropagation();
              handleExpand(true);
            }}
          >
            <input
              ref={collapsedInputRef}
              type="text"
              className={styles.chatCollapsedField}
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e as unknown as React.FormEvent);
                }
              }}
              disabled={loading || streaming}
            />
            <button
              type="button"
              className={styles.chatCollapsedSend}
              disabled={loading || streaming || !input.trim()}
              onClick={(e) => {
                e.stopPropagation();
                handleSend(e as unknown as React.FormEvent);
              }}
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render expanded state
  return (
    <div
      className={`${styles.chatRoot} ${autoExpanded ? styles.chatAutoExpand : ''}`}
      onMouseMove={handleDragMove}
      onMouseUp={handleDragEnd}
      onMouseLeave={handleDragEnd}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
    >
      <div
        className={`${styles.chatExpanded} ${justExpanded || autoExpanded ? styles.chatAutoExpand : ''}`}
      >
        {/* Drag handle */}
        <div
          className={styles.chatDragHandle}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className={styles.chatDragHandleBar} />
        </div>

        {/* Header */}
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderTitle}>
            <span className={styles.chatHeaderIcon}>💬</span>
            <span className={styles.chatHeaderText}>Concierge</span>
          </div>
          <button
            className={styles.chatHeaderClose}
            onClick={() => handleExpand(false)}
            aria-label="Collapse chat"
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div className={styles.chatMessages}>
          {messages.length === 0 && !loading && !streaming && (
            <div className={styles.chatEmpty}>
              <div className={styles.chatEmptyIcon}>🧭</div>
              <div className={styles.chatEmptyTitle}>Hey! I&apos;m your Compass Concierge.</div>
              <div className={styles.chatEmptyText}>
                Ask me about restaurants, places to visit, or help planning your next trip.
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

          {/* Streaming response in progress */}
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

          {/* Tool-use indicator */}
          {toolStatus && (
            <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
              <div className={styles.chatToolStatus}>{toolStatus}</div>
            </div>
          )}

          {/* Initial loading dots (before first token) */}
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

        {/* Input area */}
        <form className={styles.chatInputArea} onSubmit={handleSend}>
          <textarea
            ref={expandedInputRef}
            className={styles.chatInput}
            placeholder="Ask me anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e as unknown as React.FormEvent);
              }
            }}
            disabled={loading || streaming}
            rows={1}
          />
          <button
            type="submit"
            className={styles.chatSendBtn}
            disabled={loading || streaming || !input.trim()}
          >
            ➤
          </button>
        </form>
      </div>
    </div>
  );
}