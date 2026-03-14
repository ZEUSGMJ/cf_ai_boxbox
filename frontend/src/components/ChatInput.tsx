import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  disabled: boolean;
}

export default function ChatInput({ value, onChange, onSend, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && value.trim().length > 0;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;

    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className="border-t border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(14,19,30,0.9),rgba(9,12,20,0.97))] px-3 py-3 shadow-[0_-18px_36px_rgba(0,0,0,0.22)] backdrop-blur md:px-4 md:py-4">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label htmlFor="chat-input" className="sr-only">
          Ask Boxbox about Formula 1
        </label>
        <textarea
          id="chat-input"
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="Ask about races, standings, drivers, or pit strategy..."
          autoComplete="off"
          className="min-h-[3rem] w-full resize-none rounded-[22px] border border-[color:var(--border)] bg-[#0f1420] px-4 py-3 text-[0.94rem] leading-6 text-slate-100 outline-none transition-[border-color,box-shadow,opacity] duration-150 placeholder:text-[#7f8baa] focus-visible:border-[#f04558] focus-visible:shadow-[0_0_0_3px_rgba(240,69,88,0.22)] disabled:cursor-not-allowed disabled:opacity-75"
          aria-label="Message input"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="min-h-[3rem] min-w-[5.3rem] rounded-[22px] bg-[linear-gradient(150deg,#ec4155,#d92a3f)] px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(217,42,63,0.22)] transition duration-150 hover:enabled:-translate-y-px hover:enabled:bg-[linear-gradient(150deg,#f04c5f,#b91f34)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f04c5f] disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="Send message"
        >
          Send
        </button>
      </div>
      <p className="mt-2 text-center text-[0.73rem] text-slate-400">
        Powered by Llama 3.3 | Data from Jolpica F1 API
      </p>
    </div>
  );
}
