import { intentClassificationMessages } from './prompts';

export interface IntentEnv {
  AI: {
    run: (
      model: string,
      payload: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[] },
    ) => Promise<unknown>;
  };
}

export type Intent =
  | 'next_race'
  | 'race_result'
  | 'driver_standings'
  | 'constructor_standings'
  | 'both_standings'
  | 'driver_stats'
  | 'pit_stops'
  | 'race_schedule'
  | 'fallback'
  | 'live_telemetry'
  | 'capabilities';

const VALID_INTENTS = new Set<Intent>([
  'next_race',
  'race_result',
  'driver_standings',
  'constructor_standings',
  'both_standings',
  'driver_stats',
  'pit_stops',
  'race_schedule',
  'fallback',
  'live_telemetry',
  'capabilities',
]);

function isValidIntent(value: string): value is Intent {
  return VALID_INTENTS.has(value as Intent);
}

export function classifyCannedIntent(query: string): Intent | null {
  const q = query.toLowerCase().trim();

  if (
    /what can (you|boxbox) do|what do you (know|cover)|^help$|your capabilities|what (topics|questions) (can|do) you|what can (i ask|you answer)/.test(
      q,
    )
  ) {
    return 'capabilities';
  }

  if (/\blive\s+(telemetry|timing|data|feed)\b|telemetry\s+feed/.test(q)) {
    return 'live_telemetry';
  }

  return null;
}

export function keywordClassify(query: string): Intent | null {
  const q = query.toLowerCase();
  const canned = classifyCannedIntent(q);
  if (canned) return canned;

  if (
    /\bwho won\b|\brace results?\b|\blast race\b|\brace winner\b|\bsprint winner\b|\bsprint results?\b|\bpodium\b|\bwhat happened in\b|\bhow did .+ finish\b|\bresults? from\b/.test(
      q,
    )
  ) {
    return 'race_result';
  }

  if (
    /next\s+(\w+\s+)?(race|gp|grand prix)|upcoming races?|when is the next|next sprint\b|sprint race|dates?.+locations?.+circuit/.test(
      q,
    )
  ) {
    return 'next_race';
  }
  if (/\b(full\s+)?(season|2025|2026)\s+(calendar|schedule)\b|race calendar|full calendar/.test(q)) {
    return 'race_schedule';
  }
  if (/pit stop|pit strategy|pit strat/.test(q)) return 'pit_stops';
  if (
    /\bstats\b|\bthis season\b|how has .+ (done|performed|been doing)|how is .+ (performing|doing)|season performance/.test(
      q,
    )
  ) {
    return 'driver_stats';
  }
  if (/constructor stand|team stand|constructor championship|which team is lead/.test(q)) {
    return 'constructor_standings';
  }
  if (/\bdriver stand|driver championship|driver points/.test(q)) return 'driver_standings';
  // Bare standings requests without a specific qualifier should return both tables.
  if (/\bstandings\b|\bpoints table\b|both standings|all standings|detailed standings|full standings/.test(q)) {
    return 'both_standings';
  }

  return null;
}

export async function classifyIntent(query: string, env: IntentEnv): Promise<Intent> {
  const keyword = keywordClassify(query);
  if (keyword !== null) return keyword;

  try {
    const messages = intentClassificationMessages(query);
    const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
    });

    const raw = ((result as { response?: string })?.response ?? '').trim().toLowerCase();
    const token = raw.split(/\s+/)[0];
    if (isValidIntent(token)) return token;
  } catch {
    // Fall through to fallback.
  }

  return 'fallback';
}
