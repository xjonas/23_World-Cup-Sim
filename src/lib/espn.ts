import type { GroupLetter, Match, MatchOdds, Phase, Team, TournamentData } from '../types';
import { normalizeAmericanOdds, normalizeMoneylineProbabilities, normalizeTwoWayProbabilities } from './odds';

export const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=20260611-20260719';

const GROUP_RE = /Group ([A-L])/;

interface EspnTeam {
  id: string | number;
  displayName: string;
  abbreviation?: string;
  shortDisplayName?: string;
  logo?: string;
  logos?: Array<{ href: string }>;
  color?: string;
  isActive?: boolean;
}

interface EspnCompetitor {
  order: number;
  homeAway: 'home' | 'away';
  score?: string;
  winner?: boolean;
  team: EspnTeam;
}

interface EspnCompetition {
  competitors?: EspnCompetitor[];
  venue?: { fullName?: string };
  altGameNote?: string;
  odds?: Array<EspnOdds | null>;
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
      description?: string;
      detail?: string;
      shortDetail?: string;
    };
  };
}

interface EspnOddsPoint {
  odds?: string | number;
  line?: string | number;
}

interface EspnOddsSide {
  open?: EspnOddsPoint;
  close?: EspnOddsPoint;
  current?: EspnOddsPoint;
}

interface EspnOdds {
  overUnder?: number;
  link?: { href?: string };
  provider?: { name?: string; displayName?: string };
  drawOdds?: { moneyLine?: string | number };
  moneyline?: {
    home?: EspnOddsSide;
    draw?: EspnOddsSide;
    away?: EspnOddsSide;
  };
  total?: {
    over?: EspnOddsSide;
    under?: EspnOddsSide;
  };
}

interface EspnEvent {
  id: string | number;
  date: string;
  season?: { slug?: Phase };
  competitions?: EspnCompetition[];
  venue?: { displayName?: string };
  status?: EspnCompetition['status'];
}

interface EspnPayload {
  events?: EspnEvent[];
}

export async function fetchTournamentData(): Promise<TournamentData> {
  const response = await fetch(ESPN_SCOREBOARD_URL);
  if (!response.ok) {
    throw new Error(`ESPN returned ${response.status}`);
  }
  return normalizeEspnScoreboard(await response.json(), new Date().toISOString());
}

export function normalizeEspnScoreboard(payload: EspnPayload, fetchedAt: string): TournamentData {
  const teamsById = new Map<string, Team>();
  const matches: Match[] = [];

  for (const event of payload.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) {
      continue;
    }

    const competitors = [...(competition.competitors ?? [])].sort((a, b) => a.order - b.order);
    for (const competitor of competitors) {
      const team = competitor.team;
      const id = String(team.id);
      teamsById.set(id, {
        id,
        name: team.displayName,
        abbreviation: team.abbreviation || team.shortDisplayName || team.displayName,
        logoUrl: team.logo || team.logos?.[0]?.href || '',
        color: team.color,
        isPlaceholder: team.isActive === false
      });
    }

    const home = competitors.find((competitor) => competitor.homeAway === 'home') ?? competitors[0];
    const away = competitors.find((competitor) => competitor.homeAway === 'away') ?? competitors[1];
    if (!home || !away) {
      continue;
    }

    const statusType = competition.status?.type ?? event.status?.type;
    const state = statusType?.state ?? 'pre';
    const completed = Boolean(statusType?.completed);
    const hasScore = state !== 'pre';
    const winner = competitors.find((competitor) => competitor.winner);
    const group = GROUP_RE.exec(competition.altGameNote ?? '')?.[1] as GroupLetter | undefined;

    matches.push({
      id: String(event.id),
      phase: event.season?.slug ?? 'unknown',
      group,
      kickoffUtc: event.date,
      venue: competition.venue?.fullName ?? event.venue?.displayName ?? '',
      homeTeamId: String(home.team.id),
      awayTeamId: String(away.team.id),
      apiScore: hasScore
        ? {
            home: Number(home.score ?? 0),
            away: Number(away.score ?? 0)
          }
        : null,
      status: statusType?.description ?? 'Scheduled',
      statusDetail: statusType?.shortDetail ?? statusType?.detail ?? '',
      completed,
      winnerTeamId: completed && winner ? String(winner.team.id) : undefined,
      odds: normalizeEspnOdds(competition, fetchedAt)
    });
  }

  return {
    fetchedAt,
    source: ESPN_SCOREBOARD_URL,
    teams: [...teamsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    matches: matches.sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc))
  };
}

function normalizeEspnOdds(competition: EspnCompetition, fetchedAt: string): MatchOdds | undefined {
  const rawOdds = competition.odds?.find((odds): odds is EspnOdds => Boolean(odds));
  if (!rawOdds) {
    return undefined;
  }

  const moneyline = normalizeMoneylineProbabilities(
    pickAmericanProbability(rawOdds.moneyline?.home),
    pickAmericanProbability(rawOdds.moneyline?.draw) ?? normalizeAmericanOdds(rawOdds.drawOdds?.moneyLine),
    pickAmericanProbability(rawOdds.moneyline?.away)
  );
  const totalLine = pickLine(rawOdds.total?.over) ?? pickLine(rawOdds.total?.under) ?? rawOdds.overUnder;
  const totalProbabilities = normalizeTwoWayProbabilities(
    pickAmericanProbability(rawOdds.total?.over),
    pickAmericanProbability(rawOdds.total?.under)
  );

  if (!moneyline && totalLine === undefined) {
    return undefined;
  }

  return {
    provider: `${rawOdds.provider?.displayName ?? rawOdds.provider?.name ?? 'ESPN odds'} via ESPN`,
    fetchedAt,
    moneyline,
    totalGoals:
      totalLine !== undefined
        ? {
            line: totalLine,
            over: totalProbabilities?.[0],
            under: totalProbabilities?.[1]
          }
        : undefined,
    confidence: moneyline ? 'high' : 'medium',
    sourceUrl: rawOdds.link?.href
  };
}

function pickAmericanProbability(side: EspnOddsSide | undefined) {
  return (
    normalizeAmericanOdds(side?.current?.odds) ??
    normalizeAmericanOdds(side?.close?.odds) ??
    normalizeAmericanOdds(side?.open?.odds)
  );
}

function pickLine(side: EspnOddsSide | undefined) {
  return parseLine(side?.current?.line) ?? parseLine(side?.close?.line) ?? parseLine(side?.open?.line);
}

function parseLine(value: string | number | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value.replace(/^[ou]/i, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}
