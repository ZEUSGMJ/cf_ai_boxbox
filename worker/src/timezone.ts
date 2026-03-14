import type { Race, SessionTime } from './jolpica';

export const SUPPORTED_TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  Australia: 'Australia/Melbourne',
  Austria: 'Europe/Vienna',
  Azerbaijan: 'Asia/Baku',
  Bahrain: 'Asia/Bahrain',
  Belgium: 'Europe/Brussels',
  Brazil: 'America/Sao_Paulo',
  Canada: 'America/Toronto',
  China: 'Asia/Shanghai',
  Hungary: 'Europe/Budapest',
  Italy: 'Europe/Rome',
  Japan: 'Asia/Tokyo',
  Mexico: 'America/Mexico_City',
  Monaco: 'Europe/Monaco',
  Netherlands: 'Europe/Amsterdam',
  Qatar: 'Asia/Qatar',
  'Saudi Arabia': 'Asia/Riyadh',
  Singapore: 'Asia/Singapore',
  Spain: 'Europe/Madrid',
  'United Arab Emirates': 'Asia/Dubai',
  'United Kingdom': 'Europe/London',
};

const LOCALITY_TIMEZONE_OVERRIDES: Record<string, string> = {
  austin: 'America/Chicago',
  'las vegas': 'America/Los_Angeles',
  miami: 'America/New_York',
  montreal: 'America/Toronto',
  imola: 'Europe/Rome',
  monza: 'Europe/Rome',
  silverstone: 'Europe/London',
  budapest: 'Europe/Budapest',
  spa: 'Europe/Brussels',
  spielberg: 'Europe/Vienna',
};

export interface RaceTimeContext {
  utc: string;
  userLocal: string;
  circuitLocal: string;
  circuitTimezone: string;
  usedFallbackTimezone: boolean;
}

export interface EnrichedRace extends Race {
  timeContext?: {
    raceStart?: RaceTimeContext;
    sprint?: RaceTimeContext;
    sprintQualifying?: RaceTimeContext;
  };
}

function formatUtcIso(date: string, time?: string): string | null {
  if (!time) return null;
  return `${date}T${time}`;
}

function formatInTimezone(isoUtc: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  return formatter.format(new Date(isoUtc));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveCircuitTimezone(race: Pick<Race, 'Circuit'>): {
  timezone: string;
  usedFallbackTimezone: boolean;
} {
  const locality = normalizeKey(race.Circuit.Location.locality);
  const country = race.Circuit.Location.country;

  for (const [key, timezone] of Object.entries(LOCALITY_TIMEZONE_OVERRIDES)) {
    if (locality.includes(key)) {
      return { timezone, usedFallbackTimezone: false };
    }
  }

  const countryMatch = COUNTRY_TIMEZONE_MAP[country];
  if (countryMatch) {
    return { timezone: countryMatch, usedFallbackTimezone: false };
  }

  return { timezone: 'UTC', usedFallbackTimezone: true };
}

function buildSessionContext(
  session: { date: string; time?: string } | SessionTime | undefined,
  userTimezone: string,
  circuitTimezone: string,
  usedFallbackTimezone: boolean,
): RaceTimeContext | undefined {
  if (!session?.time) return undefined;

  const utc = formatUtcIso(session.date, session.time);
  if (!utc) return undefined;

  return {
    utc,
    userLocal: formatInTimezone(utc, userTimezone),
    circuitLocal: formatInTimezone(utc, circuitTimezone),
    circuitTimezone,
    usedFallbackTimezone,
  };
}

export function enrichRaceWithTimeContext(race: Race, userTimezone: string): EnrichedRace {
  const { timezone: circuitTimezone, usedFallbackTimezone } = resolveCircuitTimezone(race);
  const raceStart = buildSessionContext(race, userTimezone, circuitTimezone, usedFallbackTimezone);
  const sprint = buildSessionContext(race.Sprint, userTimezone, circuitTimezone, usedFallbackTimezone);
  const sprintQualifying = buildSessionContext(
    race.SprintQualifying,
    userTimezone,
    circuitTimezone,
    usedFallbackTimezone,
  );

  return {
    ...race,
    timeContext: {
      raceStart,
      sprint,
      sprintQualifying,
    },
  };
}

export function enrichRacesWithTimeContext(races: Race[] | null, userTimezone: string): EnrichedRace[] | null {
  if (!races) return null;
  return races.map((race) => enrichRaceWithTimeContext(race, userTimezone));
}
