import { useEffect, useRef } from 'react';
import type { Message } from '../types';
import MessageBubble from './MessageBubble';

interface Props {
  messages: Message[];
  loading: boolean;
}

export default function ChatThread({ messages, loading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  return (
    <section
      className="chat-scroll flex-1 min-h-0 w-full overflow-y-auto px-1 pb-8 md:px-2 md:pb-12"
      aria-label="Chat messages"
    >
      <div className="mx-auto flex w-full max-w-[980px] flex-col">
        {messages.length === 0 && (
          <div className="mx-auto mt-[16vh] w-full max-w-lg rounded-[28px] border border-dashed border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-6 py-6 text-center shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
            <p className="m-0 text-[1rem] font-semibold text-slate-100">Ask anything about Formula 1</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Examples: "Who won the last race?" or "Show all standings."
            </p>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {loading && (
          <div className="mt-4 flex items-start gap-3" role="status" aria-label="Boxbox is typing">
            <div
              className="grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#f04558,#d92a3f)] text-[0.72rem] font-bold text-white shadow-[0_10px_22px_rgba(217,42,63,0.28)]"
              aria-hidden="true"
            >
              B
            </div>
            <div className="inline-flex items-center gap-1 rounded-2xl rounded-tl-sm border border-[color:var(--border)] bg-[linear-gradient(180deg,#171f31,#111826)] px-4 py-3 shadow-[0_14px_26px_rgba(0,0,0,0.16)]">
              <span className="size-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </section>
  );
}
