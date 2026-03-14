export interface NormalizedChatRequest {
  message: string;
  sessionId: string;
  timezone: string;
}

export interface NormalizedSessionRequest {
  sessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function validateAndNormalizeChatBody(
  body: unknown,
  supportedTimezones: ReadonlySet<string>,
): { ok: true; data: NormalizedChatRequest } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const { message, sessionId, timezone } = body;
  if (typeof message !== 'string' || typeof sessionId !== 'string' || typeof timezone !== 'string') {
    return { ok: false, error: 'Missing required fields: message, sessionId, timezone' };
  }

  const safeMessage = message.trim();
  const safeSessionId = sessionId.trim();
  const safeTimezoneInput = timezone.trim();

  if (!safeMessage) {
    return { ok: false, error: 'message must not be empty' };
  }
  if (safeMessage.length > 2000) {
    return { ok: false, error: 'message must be under 2000 characters' };
  }

  if (!safeSessionId || safeSessionId.length > 128) {
    return { ok: false, error: 'sessionId must be between 1 and 128 characters' };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(safeSessionId)) {
    return { ok: false, error: 'sessionId may only include letters, numbers, underscores, and hyphens' };
  }

  if (!safeTimezoneInput || safeTimezoneInput.length > 100) {
    return { ok: false, error: 'timezone must be between 1 and 100 characters' };
  }

  const safeTimezone = supportedTimezones.has(safeTimezoneInput) ? safeTimezoneInput : 'UTC';

  return {
    ok: true,
    data: {
      message: safeMessage,
      sessionId: safeSessionId,
      timezone: safeTimezone,
    },
  };
}

export function validateAndNormalizeSessionId(
  sessionId: unknown,
): { ok: true; data: NormalizedSessionRequest } | { ok: false; error: string } {
  if (typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId is required' };
  }

  const safeSessionId = sessionId.trim();
  if (!safeSessionId || safeSessionId.length > 128) {
    return { ok: false, error: 'sessionId must be between 1 and 128 characters' };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(safeSessionId)) {
    return { ok: false, error: 'sessionId may only include letters, numbers, underscores, and hyphens' };
  }

  return { ok: true, data: { sessionId: safeSessionId } };
}

export function extractSeason(query: string): string | null {
  const match = query.match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
}

export function extractRound(query: string): string | null {
  const match = query.match(/\b(?:round|r)\s*#?\s*(\d{1,2})\b/i);
  if (!match) return null;
  const round = Number.parseInt(match[1], 10);
  if (Number.isNaN(round) || round < 1 || round > 30) return null;
  return String(round);
}
