import { classifyCannedIntent, classifyIntent, type Intent } from './intent';
import {
  type Constructor,
  type ConstructorStanding,
  type Driver,
  type DriverStanding,
  fetchConstructorStandings,
  fetchDriverStandings,
  fetchLastRaceMeta,
  fetchLastRaceResults,
  fetchPitStops,
  fetchRaceResults,
  fetchRaceSchedule,
  type RaceResult,
  type RaceResultsEnvelope,
  fetchSprintResults,
  type SprintResultsEnvelope,
  fetchUpcomingRaces,
  findRoundByName,
  getSprintStartDate,
  type Race,
} from './jolpica';
import { type HistoryMessage, coerceStoredHistory } from './durable-validation';
import { mainSystemPrompt, queryRefinementMessages } from './prompts';
import {
  enrichRacesWithTimeContext,
  SUPPORTED_TIMEZONES,
  type EnrichedRace,
} from './timezone';
import {
  extractRound,
  extractSeason,
  validateAndNormalizeChatBody,
  validateAndNormalizeSessionId,
} from './validation';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SCHEDULE_FALLBACK_SEASON = '2025';
const DEFAULT_SCHEDULE_SEASON = '2026';
const MAX_NEXT_RACE_COUNT = 10;
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ENTITY_QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'been',
  'championship',
  'compare',
  'constructor',
  'constructors',
  'current',
  'currently',
  'did',
  'do',
  'doing',
  'driver',
  'drivers',
  'far',
  'for',
  'has',
  'have',
  'how',
  'in',
  'is',
  'me',
  'of',
  'performance',
  'performing',
  'performed',
  'points',
  'position',
  'season',
  'show',
  'so',
  'standings',
  'stats',
  'team',
  'teams',
  'the',
  'this',
  'with',
]);

export type DataStatus = 'ok' | 'partial' | 'none';

export interface ChatResponseMeta {
  intent: Intent;
  dataStatus: DataStatus;
}

export interface DriverSummaryView {
  type: 'driver_summary';
  title: string;
  season: string;
  driver: {
    name: string;
    team: string;
    position: string;
    points: number | null;
    wins: number | null;
  };
  followups: string[];
}

export interface ConstructorSummaryView {
  type: 'constructor_summary';
  title: string;
  season: string;
  constructor: {
    name: string;
    position: string;
    points: number | null;
    wins: number | null;
  };
  followups: string[];
}

export interface DriverStandingsRowView {
  position: string;
  driverName: string;
  teamName: string;
  points: number | null;
  wins: number | null;
}

export interface ConstructorStandingsRowView {
  position: string;
  constructorName: string;
  points: number | null;
  wins: number | null;
}

export interface StandingsTableView {
  type: 'standings_table';
  title: string;
  season: string;
  category: 'drivers' | 'constructors' | 'combined';
  tables: Array<
    | {
        key: 'drivers';
        title: string;
        rows: DriverStandingsRowView[];
      }
    | {
        key: 'constructors';
        title: string;
        rows: ConstructorStandingsRowView[];
      }
  >;
  unavailableTables: Array<'drivers' | 'constructors'>;
}

export interface NextRacesListView {
  type: 'next_races_list';
  title: string;
  season: string | null;
  races: Array<{
    round: string;
    raceName: string;
    circuitName: string;
    locality: string;
    country: string;
    date: string;
    userLocalTime: string | null;
    circuitLocalTime: string | null;
    hasSprint: boolean;
  }>;
}

export interface RaceResultView {
  type: 'race_result';
  title: string;
  season: string;
  round: string;
  raceName: string;
  sessionType: 'race' | 'sprint';
  circuit: {
    name: string;
    locality: string;
    country: string;
  };
  results: Array<{
    position: string;
    driverName: string;
    teamName: string;
    points: number | null;
    status: string;
    grid: string | null;
    laps: string | null;
    finishTime: string | null;
  }>;
}

export interface ClarificationView {
  type: 'clarification';
  title: string;
  message: string;
  suggestions: string[];
}

export interface ErrorView {
  type: 'error';
  title: string;
  message: string;
}

export type ResponseView =
  | DriverSummaryView
  | ConstructorSummaryView
  | StandingsTableView
  | NextRacesListView
  | RaceResultView
  | ClarificationView
  | ErrorView;

export interface ChatResponsePayload {
  response: string;
  refinedQuery?: string;
  meta: ChatResponseMeta;
  view?: ResponseView;
}

export interface DurableObjectStubLike {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName: (name: string) => unknown;
  get: (id: unknown) => DurableObjectStubLike;
}

export interface Env {
  AI: {
    run: (
      model: string,
      payload: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[] },
    ) => Promise<unknown>;
  };
  SESSION_MEMORY: DurableObjectNamespaceLike;
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function getHistory(env: Env, sessionId: string): Promise<HistoryMessage[]> {
  try {
    const id = env.SESSION_MEMORY.idFromName(sessionId);
    const stub = env.SESSION_MEMORY.get(id);
    const res = await stub.fetch('https://do/history');
    if (!res.ok) return [];
    return coerceStoredHistory(await res.json());
  } catch {
    return [];
  }
}

async function appendHistory(env: Env, sessionId: string, messages: HistoryMessage[]): Promise<void> {
  try {
    const id = env.SESSION_MEMORY.idFromName(sessionId);
    const stub = env.SESSION_MEMORY.get(id);
    await stub.fetch('https://do/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch {
    // Keep the response path resilient if memory append fails.
  }
}

async function refineQuery(message: string, history: HistoryMessage[], env: Env): Promise<string> {
  try {
    const messages = queryRefinementMessages(message, history);
    const result = await env.AI.run(MODEL, {
      messages: messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
    });
    const refined = ((result as { response?: string })?.response ?? '').trim();
    if (refined.length > 0) return refined;
  } catch {
    // Fall through.
  }
  return message;
}

async function resolveRoundFromQuery(query: string, season: string | null): Promise<{ season: string; round: string } | null> {
  if (season) {
    const round = await findRoundByName(season, query);
    return round ? { season, round } : null;
  }

  for (const candidateSeason of [DEFAULT_SCHEDULE_SEASON, SCHEDULE_FALLBACK_SEASON]) {
    const round = await findRoundByName(candidateSeason, query);
    if (round) {
      return { season: candidateSeason, round };
    }
  }

  return null;
}

function isSprintResultQuery(query: string): boolean {
  const q = query.toLowerCase();
  return /\bsprint\b/.test(q) && /\b(who won|winner|results?|podium|finish|first|last)\b/.test(q);
}

function isFirstSprintQuery(query: string): boolean {
  return /\bfirst\b.*\bsprint\b|\bsprint\b.*\bfirst\b/.test(query.toLowerCase());
}

function firstMatchingSprintRound(
  races: Race[] | null,
  predicate: (race: Race) => boolean,
): string | null {
  if (!races || races.length === 0) return null;
  const sorted = [...races].sort(
    (a, b) => Number.parseInt(a.round, 10) - Number.parseInt(b.round, 10),
  );
  const firstSprint = sorted.find(predicate);
  return firstSprint?.round ?? null;
}

function isSprintCompleted(race: Race, now: Date): boolean {
  const sprintStart = getSprintStartDate(race.Sprint);
  if (!sprintStart) return false;
  return sprintStart <= now;
}

async function resolveFirstSprintRound(
  seasonHint: string | null,
  onlyCompleted: boolean,
): Promise<{ season: string; round: string } | null> {
  const now = new Date(Date.now());
  const seasons = seasonHint
    ? [seasonHint]
    : [DEFAULT_SCHEDULE_SEASON, SCHEDULE_FALLBACK_SEASON];

  for (const season of seasons) {
    const races = await fetchRaceSchedule(season);
    const round = firstMatchingSprintRound(races, (race) =>
      onlyCompleted ? isSprintCompleted(race, now) : !!race.Sprint,
    );
    if (round) return { season, round };
  }

  return null;
}

function hasData(payload: unknown): 'ok' | 'partial' | 'none' {
  if (payload === null || payload === undefined) return 'none';
  if (Array.isArray(payload)) return payload.length > 0 ? 'ok' : 'none';

  if (typeof payload === 'object') {
    const value = payload as {
      driverStandings?: unknown[];
      constructorStandings?: unknown[];
      Results?: unknown[];
      SprintResults?: unknown[];
    };

    if ('driverStandings' in value || 'constructorStandings' in value) {
      const driversOk = Array.isArray(value.driverStandings) && value.driverStandings.length > 0;
      const constructorsOk =
        Array.isArray(value.constructorStandings) && value.constructorStandings.length > 0;
      if (driversOk && constructorsOk) return 'ok';
      if (driversOk || constructorsOk) return 'partial';
      return 'none';
    }

    if ('Results' in value) {
      return Array.isArray(value.Results) && value.Results.length > 0 ? 'ok' : 'none';
    }

    if ('SprintResults' in value) {
      return Array.isArray(value.SprintResults) && value.SprintResults.length > 0 ? 'ok' : 'none';
    }

    return 'ok';
  }

  return 'none';
}

function clampRaceCount(value: number): number {
  return Math.max(1, Math.min(value, MAX_NEXT_RACE_COUNT));
}

function extractRequestedRaceCount(query: string): number | null {
  const normalized = query.toLowerCase();
  const explicitMatch = normalized.match(
    /\b(?:next|upcoming)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:upcoming\s+)?(?:race|races|gp|gps|grand prix)\b/,
  );
  if (explicitMatch) {
    const rawValue = explicitMatch[1];
    const numericValue = Number.parseInt(rawValue, 10);
    if (Number.isFinite(numericValue)) return clampRaceCount(numericValue);
    const wordValue = NUMBER_WORDS[rawValue];
    if (wordValue) return clampRaceCount(wordValue);
  }

  if (/\bwhen is the next\b|\bnext (?:race|gp|grand prix)\b/.test(normalized)) {
    return 1;
  }

  return null;
}

function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatRaceTiming(race: EnrichedRace): string[] {
  const lines = [`Date: ${formatCalendarDate(race.date)}`];
  const raceStart = race.timeContext?.raceStart;

  if (raceStart) {
    lines.push(`Your time: ${raceStart.userLocal}`);
    lines.push(`Circuit local time: ${raceStart.circuitLocal}`);
  }

  return lines;
}

function inferStandingsSeason(refinedQuery: string): string {
  return extractSeason(refinedQuery) ?? DEFAULT_SCHEDULE_SEASON;
}

interface DeterministicResponse {
  response: string;
  view: ResponseView;
}

interface NormalizedDriverStanding {
  position: string;
  name: string;
  team: string;
  points: number | null;
  wins: number | null;
  driverId: string;
  givenName: string;
  familyName: string;
  code: string | null;
}

interface NormalizedConstructorStanding {
  position: string;
  name: string;
  points: number | null;
  wins: number | null;
  constructorId: string;
}

function toSafeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSafeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumericValue(value: number | null, fallback = '-'): string {
  if (value === null) return fallback;
  return Number.isInteger(value) ? String(value) : String(value);
}

function ordinalize(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function describeStandingPosition(position: string): string {
  const numeric = Number.parseInt(position, 10);
  return Number.isFinite(numeric) ? ordinalize(numeric) : position;
}

function formatPointsText(points: number | null): string {
  if (points === null) return 'an unknown number of points';
  return `${formatNumericValue(points)} ${points === 1 ? 'point' : 'points'}`;
}

function formatWinsText(wins: number | null): string {
  if (wins === null) return 'an unknown number of wins';
  return `${formatNumericValue(wins)} ${wins === 1 ? 'win' : 'wins'}`;
}

function formatDriverName(driver: Pick<Driver, 'givenName' | 'familyName'>): string {
  const fullName = `${toSafeText(driver.givenName, '').trim()} ${toSafeText(driver.familyName, '').trim()}`.trim();
  return fullName.length > 0 ? fullName : 'Unknown Driver';
}

function formatStandingPosition(
  standing: Pick<DriverStanding | ConstructorStanding, 'position' | 'positionText'>,
): string {
  return toOptionalText(standing.position) ?? toOptionalText(standing.positionText) ?? '-';
}

function normalizeDriverStanding(standing: DriverStanding): NormalizedDriverStanding {
  return {
    position: formatStandingPosition(standing),
    name: formatDriverName(standing.Driver),
    team: toSafeText(standing.Constructors[0]?.name, 'Unknown'),
    points: toSafeNumber(standing.points),
    wins: toSafeNumber(standing.wins),
    driverId: toSafeText(standing.Driver.driverId, 'unknown-driver'),
    givenName: toSafeText(standing.Driver.givenName, 'Unknown'),
    familyName: toSafeText(standing.Driver.familyName, 'Driver'),
    code: toOptionalText(standing.Driver.code),
  };
}

function normalizeConstructorStanding(standing: ConstructorStanding): NormalizedConstructorStanding {
  return {
    position: formatStandingPosition(standing),
    name: toSafeText(standing.Constructor.name, 'Unknown'),
    points: toSafeNumber(standing.points),
    wins: toSafeNumber(standing.wins),
    constructorId: toSafeText(standing.Constructor.constructorId, 'unknown-constructor'),
  };
}

function normalizeEntityToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEntitySearchTerms(query: string): string[] {
  const normalized = normalizeEntityToken(query);
  const rawWords = normalized.split(' ').filter(Boolean);
  const filteredWords = rawWords.filter(
    (word) => word.length > 1 && !ENTITY_QUERY_STOPWORDS.has(word),
  );
  const sourceWords = filteredWords.length > 0 ? filteredWords : rawWords;
  const terms = new Set<string>();

  for (const word of sourceWords) {
    if (word.length >= 3) terms.add(word);
  }

  for (let index = 0; index < sourceWords.length - 1; index += 1) {
    const twoWord = `${sourceWords[index]} ${sourceWords[index + 1]}`.trim();
    if (twoWord.split(' ').length === 2) terms.add(twoWord);
  }

  if (sourceWords.includes('max') || sourceWords.includes('verstappen')) {
    terms.add('max');
    terms.add('verstappen');
    terms.add('max verstappen');
  }

  return [...terms];
}

function scoreAliasMatch(searchTerms: string[], aliases: string[]): number {
  let score = 0;

  for (const term of searchTerms) {
    if (!term) continue;
    if (aliases.includes(term)) {
      score = Math.max(score, term.includes(' ') ? 100 : 85);
      continue;
    }

    if (aliases.some((alias) => alias.startsWith(term) || alias.endsWith(term))) {
      score = Math.max(score, 72);
      continue;
    }

    if (aliases.some((alias) => alias.includes(term) || term.includes(alias))) {
      score = Math.max(score, 58);
    }
  }

  return score;
}

function findBestDriverMatch(
  query: string,
  driverStandings: NormalizedDriverStanding[],
): { standing: NormalizedDriverStanding; score: number } | null {
  const searchTerms = extractEntitySearchTerms(query);
  let bestMatch: { standing: NormalizedDriverStanding; score: number } | null = null;

  for (const standing of driverStandings) {
    const aliases = [
      normalizeEntityToken(standing.name),
      normalizeEntityToken(standing.familyName),
      normalizeEntityToken(standing.givenName),
      normalizeEntityToken(standing.code ?? ''),
      normalizeEntityToken(standing.driverId),
    ].filter(Boolean);

    const score = scoreAliasMatch(searchTerms, aliases);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { standing, score };
    }
  }

  return bestMatch && bestMatch.score >= 58 ? bestMatch : null;
}

function normalizeConstructorAlias(value: string): string {
  return normalizeEntityToken(value)
    .replace(/\b(formula one|formula 1|f1|team|racing|scuderia|aramco)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBestConstructorMatch(
  query: string,
  constructorStandings: NormalizedConstructorStanding[],
): { standing: NormalizedConstructorStanding; score: number } | null {
  const searchTerms = extractEntitySearchTerms(query);
  let bestMatch: { standing: NormalizedConstructorStanding; score: number } | null = null;

  for (const standing of constructorStandings) {
    const aliases = [
      normalizeEntityToken(standing.name),
      normalizeConstructorAlias(standing.name),
      normalizeEntityToken(standing.constructorId),
    ].filter(Boolean);

    const score = scoreAliasMatch(searchTerms, aliases);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { standing, score };
    }
  }

  return bestMatch && bestMatch.score >= 58 ? bestMatch : null;
}

function formatList(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function buildErrorResponse(title: string, message: string): DeterministicResponse {
  return {
    response: message,
    view: {
      type: 'error',
      title,
      message,
    },
  };
}

function buildClarificationResponse(message: string): DeterministicResponse {
  return {
    response: message,
    view: {
      type: 'clarification',
      title: 'Clarification Needed',
      message,
      suggestions: [
        'Use the full driver name, such as "Lewis Hamilton".',
        'Use the full constructor name, such as "Ferrari".',
        'Ask for "Show driver standings" if you want the full table.',
      ],
    },
  };
}

function buildNextRacesResponse(
  requestQuery: string,
  races: EnrichedRace[] | null,
): DeterministicResponse {
  if (!races || races.length === 0) {
    return buildErrorResponse(
      'No Upcoming Races',
      'I could not find any upcoming races in the current schedule data.',
    );
  }

  const requestedCount = extractRequestedRaceCount(requestQuery);
  const selectedRaces =
    requestedCount === null ? races : races.slice(0, Math.min(requestedCount, races.length));

  const normalizedRaces = selectedRaces.map((race) => ({
    round: toSafeText(race.round, '-'),
    raceName: toSafeText(race.raceName, 'Unknown race'),
    circuitName: toSafeText(race.Circuit?.circuitName, 'Unknown circuit'),
    locality: toSafeText(race.Circuit?.Location?.locality, 'Unknown'),
    country: toSafeText(race.Circuit?.Location?.country, 'Unknown'),
    date: toSafeText(race.date, 'Unknown'),
    userLocalTime: toOptionalText(race.timeContext?.raceStart?.userLocal),
    circuitLocalTime: toOptionalText(race.timeContext?.raceStart?.circuitLocal),
    hasSprint: Boolean(race.Sprint),
  }));

  const title =
    normalizedRaces.length === 1
      ? 'Next Race'
      : `Next ${normalizedRaces.length} Races`;

  const response =
    normalizedRaces.length === 1
      ? (() => {
          const race = normalizedRaces[0];
          const dateText =
            /^\d{4}-\d{2}-\d{2}$/.test(race.date) ? formatCalendarDate(race.date) : race.date;
          const timeText = race.userLocalTime ? ` It starts ${race.userLocalTime} in your time.` : '';
          return `The next race is the ${race.raceName} at ${race.circuitName} in ${race.locality}, ${race.country} on ${dateText}.${timeText}`;
        })()
      : `The next ${normalizedRaces.length} races are ${formatList(normalizedRaces.map((race) => race.raceName))}.`;

  return {
    response,
    view: {
      type: 'next_races_list',
      title,
      season: toOptionalText(selectedRaces[0]?.season ?? null),
      races: normalizedRaces,
    },
  };
}

function buildStandingsResponse(
  intent: Intent,
  refinedQuery: string,
  payload: unknown,
): DeterministicResponse | null {
  const season = inferStandingsSeason(refinedQuery);

  if (intent === 'driver_standings') {
    const rows = (Array.isArray(payload) ? payload : []).map((standing) =>
      normalizeDriverStanding(standing as DriverStanding),
    );
    if (rows.length === 0) {
      return buildErrorResponse(
        'Driver Standings Unavailable',
        `I could not retrieve the current ${season} driver standings.`,
      );
    }

    return {
      response: `Here are the current ${season} driver standings.`,
      view: {
        type: 'standings_table',
        title: `${season} Driver Standings`,
        season,
        category: 'drivers',
        tables: [
          {
            key: 'drivers',
            title: 'Driver Standings',
            rows: rows.map((row) => ({
              position: row.position,
              driverName: row.name,
              teamName: row.team,
              points: row.points,
              wins: row.wins,
            })),
          },
        ],
        unavailableTables: [],
      },
    };
  }

  if (intent === 'constructor_standings') {
    const rows = (Array.isArray(payload) ? payload : []).map((standing) =>
      normalizeConstructorStanding(standing as ConstructorStanding),
    );
    if (rows.length === 0) {
      return buildErrorResponse(
        'Constructor Standings Unavailable',
        `I could not retrieve the current ${season} constructor standings.`,
      );
    }

    return {
      response: `Here are the current ${season} constructor standings.`,
      view: {
        type: 'standings_table',
        title: `${season} Constructor Standings`,
        season,
        category: 'constructors',
        tables: [
          {
            key: 'constructors',
            title: 'Constructor Standings',
            rows: rows.map((row) => ({
              position: row.position,
              constructorName: row.name,
              points: row.points,
              wins: row.wins,
            })),
          },
        ],
        unavailableTables: [],
      },
    };
  }

  if (intent !== 'both_standings' || !payload || typeof payload !== 'object') {
    return null;
  }

  const standingsPayload = payload as {
    driverStandings?: DriverStanding[] | null;
    constructorStandings?: ConstructorStanding[] | null;
  };
  const driverRows = (Array.isArray(standingsPayload.driverStandings)
    ? standingsPayload.driverStandings
    : []
  ).map((standing) => normalizeDriverStanding(standing));
  const constructorRows = (Array.isArray(standingsPayload.constructorStandings)
    ? standingsPayload.constructorStandings
    : []
  ).map((standing) => normalizeConstructorStanding(standing));

  if (driverRows.length === 0 && constructorRows.length === 0) {
    return buildErrorResponse(
      'Standings Unavailable',
      `I could not retrieve the current ${season} driver or constructor standings.`,
    );
  }

  const unavailableTables: Array<'drivers' | 'constructors'> = [];
  const tables: StandingsTableView['tables'] = [];

  if (driverRows.length > 0) {
    tables.push({
      key: 'drivers',
      title: 'Driver Standings',
      rows: driverRows.map((row) => ({
        position: row.position,
        driverName: row.name,
        teamName: row.team,
        points: row.points,
        wins: row.wins,
      })),
    });
  } else {
    unavailableTables.push('drivers');
  }

  if (constructorRows.length > 0) {
    tables.push({
      key: 'constructors',
      title: 'Constructor Standings',
      rows: constructorRows.map((row) => ({
        position: row.position,
        constructorName: row.name,
        points: row.points,
        wins: row.wins,
      })),
    });
  } else {
    unavailableTables.push('constructors');
  }

  const response =
    unavailableTables.length === 0
      ? `Here are the current ${season} Formula 1 driver and constructor standings.`
      : unavailableTables.includes('drivers')
        ? `I could only retrieve the current ${season} constructor standings.`
        : `I could only retrieve the current ${season} driver standings.`;

  return {
    response,
    view: {
      type: 'standings_table',
      title: `${season} Formula 1 Standings`,
      season,
      category: 'combined',
      tables,
      unavailableTables,
    },
  };
}

function buildDriverStatsResponse(refinedQuery: string, payload: unknown): DeterministicResponse {
  const season = inferStandingsSeason(refinedQuery);
  const standingsPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as {
          driverStandings?: DriverStanding[] | null;
          constructorStandings?: ConstructorStanding[] | null;
        })
      : null;
  const driverStandings = (
    Array.isArray(payload)
      ? payload
      : Array.isArray(standingsPayload?.driverStandings)
        ? standingsPayload.driverStandings
        : []
  ).map((standing) => normalizeDriverStanding(standing as DriverStanding));
  const constructorStandings = (
    Array.isArray(standingsPayload?.constructorStandings) ? standingsPayload.constructorStandings : []
  ).map((standing) => normalizeConstructorStanding(standing));

  if (driverStandings.length === 0 && constructorStandings.length === 0) {
    return buildErrorResponse(
      'Performance Data Unavailable',
      `I could not retrieve performance data for the ${season} season.`,
    );
  }

  const driverMatch = findBestDriverMatch(refinedQuery, driverStandings);
  const constructorMatch = findBestConstructorMatch(refinedQuery, constructorStandings);

  if (driverMatch && (!constructorMatch || driverMatch.score >= constructorMatch.score)) {
    const standing = driverMatch.standing;
    return {
      response: `${standing.name} is currently ${describeStandingPosition(standing.position)} in the ${season} driver standings with ${formatPointsText(standing.points)} and ${formatWinsText(standing.wins)} for ${standing.team}.`,
      view: {
        type: 'driver_summary',
        title: `${standing.name} in ${season}`,
        season,
        driver: {
          name: standing.name,
          team: standing.team,
          position: standing.position,
          points: standing.points,
          wins: standing.wins,
        },
        followups: [
          'Show full driver standings',
          `How did ${standing.givenName} do in the last race?`,
          `Compare ${standing.familyName} with Russell`,
        ],
      },
    };
  }

  if (constructorMatch) {
    const standing = constructorMatch.standing;
    return {
      response: `${standing.name} is currently ${describeStandingPosition(standing.position)} in the ${season} constructor standings with ${formatPointsText(standing.points)} and ${formatWinsText(standing.wins)}.`,
      view: {
        type: 'constructor_summary',
        title: `${standing.name} in ${season}`,
        season,
        constructor: {
          name: standing.name,
          position: standing.position,
          points: standing.points,
          wins: standing.wins,
        },
        followups: [
          'Show full constructor standings',
          `How did ${standing.name} do in the last race?`,
          `Which ${standing.name} driver is ahead in the standings?`,
        ],
      },
    };
  }

  return buildClarificationResponse(
    'I could not confidently identify the driver or constructor from your question. Please use the full name.',
  );
}

function normalizeRaceResultDriver(driver: Driver): string {
  return formatDriverName(driver);
}

function normalizeRaceResultTeam(constructor: Constructor): string {
  return toSafeText(constructor.name, 'Unknown');
}

function buildRaceResultResponse(payload: unknown): DeterministicResponse {
  if (!payload || typeof payload !== 'object') {
    return buildErrorResponse(
      'Race Results Unavailable',
      'I could not retrieve results for that race.',
    );
  }

  const isSprint = 'SprintResults' in payload;
  const envelope = payload as RaceResultsEnvelope | SprintResultsEnvelope;
  const rawResults = Array.isArray(
    isSprint
      ? (payload as SprintResultsEnvelope).SprintResults
      : (payload as RaceResultsEnvelope).Results,
  )
    ? (isSprint
        ? (payload as SprintResultsEnvelope).SprintResults
        : (payload as RaceResultsEnvelope).Results)
    : [];

  const results = rawResults.map((result: RaceResult) => ({
    position:
      toOptionalText(result.position) ?? toOptionalText(result.positionText) ?? '-',
    driverName: normalizeRaceResultDriver(result.Driver),
    teamName: normalizeRaceResultTeam(result.Constructor),
    points: toSafeNumber(result.points),
    status: toSafeText(result.status, 'Unknown'),
    grid: toOptionalText(result.grid),
    laps: toOptionalText(result.laps),
    finishTime: toOptionalText(result.Time?.time),
  }));

  if (results.length === 0) {
    return buildErrorResponse(
      'Race Results Unavailable',
      'I could not retrieve results for that race.',
    );
  }

  const winner = results[0];
  const podium = results.slice(0, 3).map((result) => result.driverName);
  const season = toSafeText(envelope.season, DEFAULT_SCHEDULE_SEASON);
  const raceName = toSafeText(envelope.raceName, 'Unknown race');
  const sessionLabel = isSprint ? 'sprint' : 'race';
  const podiumText =
    podium.length >= 2 ? ` The podium was ${formatList(podium)}.` : '';

  return {
    response: `${winner.driverName} won the ${season} ${raceName} ${sessionLabel} for ${winner.teamName}.${podiumText}`,
    view: {
      type: 'race_result',
      title: `${raceName} ${isSprint ? 'Sprint Results' : 'Race Results'}`,
      season,
      round: toSafeText(envelope.round, '-'),
      raceName,
      sessionType: isSprint ? 'sprint' : 'race',
      circuit: {
        name: toSafeText(envelope.Circuit?.circuitName, 'Unknown circuit'),
        locality: toSafeText(envelope.Circuit?.Location?.locality, 'Unknown'),
        country: toSafeText(envelope.Circuit?.Location?.country, 'Unknown'),
      },
      results,
    },
  };
}

export async function fetchDataForIntent(
  intent: Intent,
  refinedQuery: string,
  timezone: string,
): Promise<unknown> {
  switch (intent) {
    case 'next_race': {
      const requestedCount = extractRequestedRaceCount(refinedQuery);
      const races = await fetchUpcomingRaces(requestedCount ?? 5);
      return enrichRacesWithTimeContext(races, timezone);
    }

    case 'race_result': {
      const sprintQuery = isSprintResultQuery(refinedQuery);
      const season = extractSeason(refinedQuery);
      const round = extractRound(refinedQuery);

      if (sprintQuery && season && round) {
        return fetchSprintResults(season, round);
      }

      if (sprintQuery && isFirstSprintQuery(refinedQuery)) {
        const firstSprint = await resolveFirstSprintRound(season, true);
        if (firstSprint) {
          return fetchSprintResults(firstSprint.season, firstSprint.round);
        }
        return null;
      }

      if (sprintQuery && season && !round) {
        const namedRound = await findRoundByName(season, refinedQuery);
        if (namedRound) return fetchSprintResults(season, namedRound);
      }

      if (sprintQuery && !season && !round) {
        const resolved = await resolveRoundFromQuery(refinedQuery, null);
        if (resolved) return fetchSprintResults(resolved.season, resolved.round);
      }

      if (season && round) {
        return fetchRaceResults(season, round);
      }

      if (season && !round) {
        const namedRound = await findRoundByName(season, refinedQuery);
        if (namedRound) return fetchRaceResults(season, namedRound);
      }

      if (!season) {
        const resolved = await resolveRoundFromQuery(refinedQuery, null);
        if (resolved) return fetchRaceResults(resolved.season, resolved.round);
      }

      return fetchLastRaceResults();
    }

    case 'driver_standings':
      return fetchDriverStandings();

    case 'constructor_standings':
      return fetchConstructorStandings();

    case 'both_standings': {
      const [driverStandings, constructorStandings] = await Promise.all([
        fetchDriverStandings(),
        fetchConstructorStandings(),
      ]);
      return { driverStandings, constructorStandings };
    }

    case 'driver_stats': {
      const [driverStandings, constructorStandings] = await Promise.all([
        fetchDriverStandings(),
        fetchConstructorStandings(),
      ]);
      return { driverStandings, constructorStandings };
    }

    case 'pit_stops': {
      const season = extractSeason(refinedQuery);
      const round = extractRound(refinedQuery);
      if (season && round) {
        return fetchPitStops(season, round);
      }

      if (season && !round) {
        const namedRound = await findRoundByName(season, refinedQuery);
        if (namedRound) return fetchPitStops(season, namedRound);
      }

      if (!season) {
        const resolved = await resolveRoundFromQuery(refinedQuery, null);
        if (resolved) return fetchPitStops(resolved.season, resolved.round);
      }

      const meta = await fetchLastRaceMeta();
      if (!meta) return null;
      return fetchPitStops(meta.season, meta.round);
    }

    case 'race_schedule': {
      const requestedSeason = extractSeason(refinedQuery) ?? DEFAULT_SCHEDULE_SEASON;
      let races = await fetchRaceSchedule(requestedSeason);
      if ((!races || races.length === 0) && requestedSeason === DEFAULT_SCHEDULE_SEASON) {
        races = await fetchRaceSchedule(SCHEDULE_FALLBACK_SEASON);
      }
      return enrichRacesWithTimeContext(races, timezone);
    }

    case 'fallback':
      if (/next|upcoming|sprint/.test(refinedQuery.toLowerCase())) {
        const requestedCount = extractRequestedRaceCount(refinedQuery);
        const races = await fetchUpcomingRaces(requestedCount ?? 5);
        return enrichRacesWithTimeContext(races, timezone);
      }
      return null;

    default:
      return null;
  }
}

function capabilitiesText(): string {
  return `Here's what I can help you with:

- **Next race** - upcoming GP dates, times, locations, and sprint weekends
- **Race results** - last race or any specific race by season and round
- **Driver standings** - current championship points table
- **Constructor standings** - team points table
- **Combined standings** - driver and constructor tables together
- **Driver stats** - season performance for any driver
- **Pit stop strategies** - stop timing and duration for a race
- **Full season schedule** - complete 2026 (or fallback 2025) calendar

Try asking: *"Who won the last race?"*, *"When is the next sprint?"*, or *"Show me all standings."*`;
}

async function appendHistoryAndRespond(
  env: Env,
  sessionId: string,
  refinedQuery: string,
  payload: ChatResponsePayload,
): Promise<Response> {
  await appendHistory(env, sessionId, [
    { role: 'user', content: refinedQuery },
    { role: 'assistant', content: payload.response },
  ]);

  return corsJson(payload);
}

export async function handleWorkerFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' && (url.pathname === '/chat' || url.pathname === '/history')) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'GET' && url.pathname === '/history') {
    const validation = validateAndNormalizeSessionId(url.searchParams.get('sessionId'));
    if (!validation.ok) {
      return corsJson({ error: validation.error }, 400);
    }

    const history = await getHistory(env, validation.data.sessionId);
    return corsJson({ history });
  }

  if (request.method !== 'POST' || url.pathname !== '/chat') {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: 'Invalid JSON body' }, 400);
  }

  const validation = validateAndNormalizeChatBody(body, SUPPORTED_TIMEZONES);
  if (!validation.ok) {
    return corsJson({ error: validation.error }, 400);
  }

  const requestId = crypto.randomUUID();
  const { message, sessionId, timezone } = validation.data;
  console.log(
    JSON.stringify({
      requestId,
      event: 'chat_request',
      sessionLength: sessionId.length,
      messageLength: message.length,
      timezone,
    }),
  );

  const history = await getHistory(env, sessionId);
  const cannedIntent = classifyCannedIntent(message);
  const refinedQuery = cannedIntent ? message : await refineQuery(message, history, env);
  const intent = cannedIntent ?? (await classifyIntent(refinedQuery, env));

  console.log(
    JSON.stringify({
      requestId,
      event: 'intent_resolved',
      intent,
      refined: refinedQuery !== message,
    }),
  );

  if (intent === 'live_telemetry') {
    return appendHistoryAndRespond(env, sessionId, refinedQuery, {
      response: 'Live telemetry is not yet supported.',
      meta: { intent, dataStatus: 'none' },
    });
  }

  if (intent === 'capabilities') {
    return appendHistoryAndRespond(env, sessionId, refinedQuery, {
      response: capabilitiesText(),
      meta: { intent, dataStatus: 'none' },
    });
  }

  const fetchedData = await fetchDataForIntent(intent, refinedQuery, timezone);
  const dataStatus = hasData(fetchedData);
  console.log(
    JSON.stringify({
      requestId,
      event: 'data_fetch',
      intent,
      dataStatus,
    }),
  );

  if (intent === 'next_race') {
    const built = buildNextRacesResponse(
      message,
      Array.isArray(fetchedData) ? (fetchedData as EnrichedRace[]) : null,
    );
    return appendHistoryAndRespond(env, sessionId, refinedQuery, {
      response: built.response,
      refinedQuery: refinedQuery !== message ? refinedQuery : undefined,
      meta: { intent, dataStatus },
      view: built.view,
    });
  }

  if (
    intent === 'driver_standings' ||
    intent === 'constructor_standings' ||
    intent === 'both_standings'
  ) {
    const built =
      buildStandingsResponse(intent, refinedQuery, fetchedData) ??
      buildErrorResponse('Standings Unavailable', 'I could not retrieve the current standings.');

    return appendHistoryAndRespond(env, sessionId, refinedQuery, {
      response: built.response,
      refinedQuery: refinedQuery !== message ? refinedQuery : undefined,
      meta: { intent, dataStatus },
      view: built.view,
    });
  }

  if (intent === 'driver_stats') {
    const built = buildDriverStatsResponse(refinedQuery, fetchedData);
    return appendHistoryAndRespond(env, sessionId, refinedQuery, {
      response: built.response,
      refinedQuery: refinedQuery !== message ? refinedQuery : undefined,
      meta: { intent, dataStatus },
      view: built.view,
    });
  }

  if (intent === 'race_result') {
    const built = buildRaceResultResponse(fetchedData);
    return appendHistoryAndRespond(env, sessionId, refinedQuery, {
      response: built.response,
      refinedQuery: refinedQuery !== message ? refinedQuery : undefined,
      meta: { intent, dataStatus },
      view: built.view,
    });
  }

  const today = new Date().toISOString().split('T')[0];
  let systemPrompt = mainSystemPrompt(timezone, today);
  if (fetchedData) {
    systemPrompt += `\n\n[F1 DATA]\n${JSON.stringify(fetchedData, null, 2)}\n[/F1 DATA]`;
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: refinedQuery },
  ];

  let assistantText: string;
  try {
    const result = await env.AI.run(MODEL, { messages });
    assistantText =
      ((result as { response?: string })?.response ?? '').trim() ||
      'I was unable to generate a response.';
  } catch {
    assistantText = 'An error occurred while generating a response. Please try again.';
  }

  return appendHistoryAndRespond(env, sessionId, refinedQuery, {
    response: assistantText,
    refinedQuery: refinedQuery !== message ? refinedQuery : undefined,
    meta: { intent, dataStatus },
  });
}
