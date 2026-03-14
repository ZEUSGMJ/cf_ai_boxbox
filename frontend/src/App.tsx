import { useEffect, useState } from 'react';
import type { Message } from './types';
import ChatInput from './components/ChatInput';
import ChatThread from './components/ChatThread';

function getOrCreateSessionId(): string {
  const key = 'boxbox_session_id';

  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;

    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function resolveEndpoint(pathname: 'chat' | 'history'): string {
  const configured = (import.meta.env.VITE_WORKER_URL ?? '').trim();
  if (!configured) return `/${pathname}`;
  if (new RegExp(`/${pathname}/?$`, 'i').test(configured)) return configured.replace(/\/+$/, '');
  if (/\/chat\/?$/i.test(configured) || /\/history\/?$/i.test(configured)) {
    return configured.replace(/\/(chat|history)\/?$/i, `/${pathname}`);
  }

  try {
    const base = configured.endsWith('/') ? configured : `${configured}/`;
    return new URL(pathname, base).toString();
  } catch {
    if (configured.startsWith('/')) return `${configured.replace(/\/+$/, '')}/${pathname}`;
    return `/${pathname}`;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(getOrCreateSessionId);
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const chatEndpoint = resolveEndpoint('chat');
  const historyEndpoint = resolveEndpoint('history');

  useEffect(() => {
    let active = true;

    const loadHistory = async () => {
      try {
        const url = new URL(historyEndpoint, window.location.origin);
        url.searchParams.set('sessionId', sessionId);
        const res = await fetch(url.toString());
        if (!res.ok) return;

        const data = (await res.json()) as {
          history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        };
        if (!active || !Array.isArray(data.history)) return;

        setMessages(
          data.history.map((message) => ({
            id: crypto.randomUUID(),
            role: message.role,
            content: message.content,
          })),
        );
      } catch {
        // Leave the thread empty if history hydration fails.
      }
    };

    void loadHistory();

    return () => {
      active = false;
    };
  }, [historyEndpoint, sessionId]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, sessionId, timezone }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as {
        response?: string;
        refinedQuery?: string;
        view?: Message['view'];
      };

      if (typeof data.response !== 'string') {
        throw new Error('Unexpected response from server');
      }

      if (data.refinedQuery) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === userMsg.id ? { ...message, refinedQuery: data.refinedQuery } : message,
          ),
        );
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        view: data.view,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I could not reach the Boxbox service. Please try again.',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-dvh overflow-hidden bg-[radial-gradient(circle_at_12%_6%,rgba(217,42,63,0.2),transparent_38%),radial-gradient(circle_at_90%_4%,rgba(42,111,217,0.14),transparent_34%),#080a10] text-slate-100">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-(--border) bg-[linear-gradient(180deg,rgba(18,23,35,0.94),rgba(12,16,26,0.92))] px-4 py-4 backdrop-blur md:px-5">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-[linear-gradient(140deg,#f04558,#d92a3f)] text-sm font-bold text-white">
              B
            </div>
            <div className="flex items-baseline gap-2">
              <h1 className="m-0 text-base font-semibold tracking-[0.02em] text-white">Box Box</h1>
              <p className="m-0 text-xs text-slate-500">|</p>
              <p className="m-0 text-xs uppercase tracking-[0.26em] text-slate-400">F1 Assistant</p>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-400" aria-label="Service ready">
              <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span>Ready</span>
            </div>
          </div>
        </header>

        <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-2 pt-4 md:px-4 md:pt-6">
          <ChatThread messages={messages} loading={loading} />
        </main>

        <ChatInput value={input} onChange={setInput} onSend={handleSend} disabled={loading} />
      </div>
    </div>
  );
}
