export type HistoryRole = 'user' | 'assistant';

export interface HistoryMessage {
  role: HistoryRole;
  content: string;
}

export const HISTORY_LIMIT = 20;
export const HISTORY_MESSAGE_MAX_LEN = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHistoryRole(value: unknown): value is HistoryRole {
  return value === 'user' || value === 'assistant';
}

export function normalizeHistoryMessage(input: unknown): HistoryMessage | null {
  if (!isRecord(input)) return null;
  if (!isHistoryRole(input.role)) return null;
  if (typeof input.content !== 'string') return null;

  const content = input.content.trim();
  if (!content || content.length > HISTORY_MESSAGE_MAX_LEN) return null;

  return {
    role: input.role,
    content,
  };
}

export function validateHistoryWritePayload(
  input: unknown,
): { ok: true; messages: HistoryMessage[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'Expected an array of messages' };
  }

  const validated: HistoryMessage[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const normalized = normalizeHistoryMessage(input[i]);
    if (!normalized) {
      return {
        ok: false,
        error: `Invalid message at index ${i}. Each message must include role ('user' | 'assistant') and non-empty content under ${HISTORY_MESSAGE_MAX_LEN} characters.`,
      };
    }
    validated.push(normalized);
  }

  return { ok: true, messages: validated };
}

export function coerceStoredHistory(input: unknown): HistoryMessage[] {
  if (!Array.isArray(input)) return [];

  const history: HistoryMessage[] = [];
  for (const item of input) {
    const normalized = normalizeHistoryMessage(item);
    if (normalized) history.push(normalized);
  }

  return capHistory(history);
}

export function capHistory(history: HistoryMessage[]): HistoryMessage[] {
  if (history.length <= HISTORY_LIMIT) return history;
  return history.slice(-HISTORY_LIMIT);
}
