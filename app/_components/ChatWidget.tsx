'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../_lib/types';

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

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load chat history on first open
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      loadChatHistory();
    }
  }, [isOpen]);

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolStatus]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

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

  return (
    <>
      <button
        className="chat-fab"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {isOpen && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <h3>Concierge</h3>
            <button
              className="btn-icon btn-ghost"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
            >
              ✕
            </button>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && !loading && !streaming && (
              <div className="chat-empty">
                <p>Hey! I&apos;m your Compass Concierge.</p>
                <p>Ask me about restaurants, places to visit, or help planning your next trip.</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`chat-message chat-message-${msg.role}`}
              >
                {msg.role === 'assistant' ? (
                  <div
                    className="chat-message-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <div className="chat-message-content">{msg.content}</div>
                )}
              </div>
            ))}

            {/* Streaming response in progress */}
            {streaming && streamContent && (
              <div className="chat-message chat-message-assistant">
                <div
                  className="chat-message-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(streamContent) }}
                />
                <span className="chat-stream-cursor" />
              </div>
            )}

            {/* Tool-use indicator */}
            {toolStatus && (
              <div className="chat-message chat-message-assistant">
                <div className="chat-message-content chat-tool-status">
                  {toolStatus}
                </div>
              </div>
            )}

            {/* Initial loading dots (before first token) */}
            {loading && (
              <div className="chat-message chat-message-assistant">
                <div className="chat-message-content chat-loading">
                  <span className="chat-typing-dot">.</span>
                  <span className="chat-typing-dot">.</span>
                  <span className="chat-typing-dot">.</span>
                </div>
              </div>
            )}

            {error && (
              <div className="chat-error">{error}</div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form className="chat-input-form" onSubmit={handleSend}>
            <input
              ref={inputRef}
              type="text"
              className="chat-input"
              placeholder="Ask me anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || streaming}
            />
            <button
              type="submit"
              className="chat-send"
              disabled={loading || streaming || !input.trim()}
            >
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  );
}
