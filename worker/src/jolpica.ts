const BASE_URL = 'https://api.jolpi.ca/ergast/f1';

export interface Location {
  locality: string;
  country: string;
}

export interface Circuit {
  circuitId: string;
  circuitName: string;
  Location: Location;
}

export interface SessionTime {
  date: string;
  time: string;
}

export interface Race {
  season: string;
  round: string;
  raceName: string;
  date: string;
  time?: string;
  Circuit: Circuit;
  Sprint?: SessionTime;
  SprintQualifying?: SessionTime;
}

export interface Driver {
  driverId: string;
  givenName: string;
  familyName: string;
  nationality: string;
  permanentNumber?: string;
  code?: string;
}

export interface Constructor {
  constructorId: string;
  name: string;
  nationality: string;
}

export interface RaceResult {
  number: string;
  position: string;
  positionText: string;
  points: string;
  Driver: Driver;
  Constructor: Constructor;
  grid: string;
  laps: string;
  status: string;
  Time?: { millis?: string; time: string };
  FastestLap?: {
    rank: string;
    lap: string;
    Time: { time: string };
    AverageSpeed: { units: string; speed: string };
  };
}

export interface DriverStanding {
  position: string;
  positionText: string;
  points: string;
  wins: string;
  Driver: Driver;
  Constructors: Constructor[];
}

export interface ConstructorStanding {
  position: string;
  positionText: string;
  points: string;
  wins: string;
  Constructor: Constructor;
}

export interface PitStop {
  driverId: string;
  lap: string;
  stop: string;
  time: string;
  duration: string;
}

function buildSessionDate(date: string, time?: string): Date {
  return new Date(time ? `${date}T${time}` : `${date}T23:59:59Z`);
}

export function getRaceStartDate(race: Pick<Race, 'date' | 'time'>): Date {
  return buildSessionDate(race.date, race.time);
}

export function getSprintStartDate(session: SessionTime | undefined): Date | null {
  if (!session) return null;
  return buildSessionDate(session.date, session.time);
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'in',
  'of',
  'at',
  'on',
  'a',
  'an',
  'who',
  'won',
  'what',
  'were',
  'results',
  'race',
  'round',
  'grand',
  'prix',
  'gp',
  'this',
  'last',
  'most',
  'recent',
  'formula',
  'season',
]);

async function jolpicaFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`Jolpica ${path} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`Jolpica fetch failed for ${path}:`, err);
    return null;
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function raceAliases(race: Race): string[] {
  const nameWithoutGrandPrix = race.raceName
    .replace(/\bgrand prix\b/i, '')
    .replace(/\bgp\b/i, '')
    .trim();
  return [
    race.raceName,
    nameWithoutGrandPrix,
    race.Circuit.circuitName,
    race.Circuit.Location.locality,
    race.Circuit.Location.country,
    `${race.Circuit.Location.locality} ${race.Circuit.Location.country}`,
  ].filter(Boolean);
}

function raceMatchScore(race: Race, query: string): number {
  const queryNorm = normalizeText(query);
  const queryTokens = new Set(tokenize(query));
  let score = 0;

  for (const alias of raceAliases(race)) {
    const aliasNorm = normalizeText(alias);
    if (!aliasNorm) continue;

    if (queryNorm.includes(aliasNorm)) {
      score = Math.max(score, 100 + aliasNorm.length);
    }

    const aliasTokens = tokenize(aliasNorm);
    if (aliasTokens.length === 0) continue;

    let overlap = 0;
    for (const token of aliasTokens) {
      if (queryTokens.has(token)) overlap += 1;
    }

    if (overlap === aliasTokens.length) {
      score = Math.max(score, 70 + overlap * 6);
    } else if (overlap > 0) {
      score = Math.max(score, overlap * 8);
    }
  }

  return score;
}

export function findRoundByNameInRaces(races: Race[], query: string): string | null {
  let bestRound: string | null = null;
  let bestScore = 0;

  for (const race of races) {
    const score = raceMatchScore(race, query);
    if (score > bestScore) {
      bestScore = score;
      bestRound = race.round;
    }
  }

  return bestScore >= 16 ? bestRound : null;
}

export async function fetchRaceSchedule(season: string): Promise<Race[] | null> {
  const data = await jolpicaFetch<{ MRData?: { RaceTable?: { Races?: Race[] } } }>(
    `/${season}/races.json`,
  );
  return data?.MRData?.RaceTable?.Races ?? null;
}

export async function fetchUpcomingRaces(limit = 5): Promise<Race[] | null> {
  const now = new Date(Date.now());

  for (const season of ['2026', '2025']) {
    const races = await fetchRaceSchedule(season);
    if (!races || races.length === 0) continue;

    const upcoming = races.filter((race) => getRaceStartDate(race) >= now);
    if (upcoming.length > 0) {
      return limit > 0 ? upcoming.slice(0, limit) : upcoming;
    }
  }

  return null;
}

export interface LastRaceMeta {
  season: string;
  round: string;
  raceName: string;
}

export async function fetchLastRaceMeta(): Promise<LastRaceMeta | null> {
  const data = await jolpicaFetch<{ MRData?: { RaceTable?: { Races?: Race[] } } }>(
    '/current/last/results.json',
  );
  const race = data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  return { season: race.season, round: race.round, raceName: race.raceName };
}

export interface RaceResultsEnvelope {
  season: string;
  round: string;
  raceName: string;
  date: string;
  Circuit: Circuit;
  Results: RaceResult[];
}

export interface SprintResultsEnvelope {
  season: string;
  round: string;
  raceName: string;
  date: string;
  Circuit: Circuit;
  SprintResults: RaceResult[];
}

export async function fetchLastRaceResults(): Promise<RaceResultsEnvelope | null> {
  const data = await jolpicaFetch<{ MRData?: { RaceTable?: { Races?: Array<Race & { Results?: RaceResult[] }> } } }>(
    '/current/last/results.json',
  );
  const race = data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    date: race.date,
    Circuit: race.Circuit,
    Results: race.Results ?? [],
  };
}

export async function fetchRaceResults(
  season: string,
  round: string,
): Promise<RaceResultsEnvelope | null> {
  const data = await jolpicaFetch<{ MRData?: { RaceTable?: { Races?: Array<Race & { Results?: RaceResult[] }> } } }>(
    `/${season}/${round}/results.json`,
  );
  const race = data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    date: race.date,
    Circuit: race.Circuit,
    Results: race.Results ?? [],
  };
}

export async function fetchSprintResults(
  season: string,
  round: string,
): Promise<SprintResultsEnvelope | null> {
  const data = await jolpicaFetch<{
    MRData?: {
      RaceTable?: { Races?: Array<Race & { SprintResults?: RaceResult[]; Results?: RaceResult[] }> };
    };
  }>(`/${season}/${round}/sprint.json`);
  const race = data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    date: race.date,
    Circuit: race.Circuit,
    SprintResults: race.SprintResults ?? race.Results ?? [],
  };
}

export async function fetchDriverStandings(): Promise<DriverStanding[] | null> {
  const data = await jolpicaFetch<{
    MRData?: { StandingsTable?: { StandingsLists?: Array<{ DriverStandings?: DriverStanding[] }> } };
  }>('/current/driverStandings.json');
  return data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? null;
}

export async function fetchConstructorStandings(): Promise<ConstructorStanding[] | null> {
  const data = await jolpicaFetch<{
    MRData?: { StandingsTable?: { StandingsLists?: Array<{ ConstructorStandings?: ConstructorStanding[] }> } };
  }>('/current/constructorStandings.json');
  return data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? null;
}

export async function findRoundByName(season: string, query: string): Promise<string | null> {
  const races = await fetchRaceSchedule(season);
  if (!races) return null;
  return findRoundByNameInRaces(races, query);
}

export async function fetchPitStops(season: string, round: string): Promise<PitStop[] | null> {
  const data = await jolpicaFetch<{ MRData?: { RaceTable?: { Races?: Array<{ PitStops?: PitStop[] }> } } }>(
    `/${season}/${round}/pitstops.json`,
  );
  return data?.MRData?.RaceTable?.Races?.[0]?.PitStops ?? null;
}
