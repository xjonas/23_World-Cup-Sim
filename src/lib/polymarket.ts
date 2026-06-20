import type { Match, MatchId, MatchOdds, Team, TeamId } from '../types';
import { normalizePolymarketPrices } from './odds';

const POLYMARKET_EVENTS_URL =
  'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=500&order=volume&ascending=false';

interface PolymarketEvent {
  title?: string;
  slug?: string;
  markets?: PolymarketMarket[];
}

interface PolymarketMarket {
  question?: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string | number;
}

interface MutableOdds {
  provider: string;
  fetchedAt: string;
  sourceUrl: string;
  homeWin?: number;
  draw?: number;
  awayWin?: number;
  total?: {
    line: number;
    over?: number;
    under?: number;
    volume: number;
  };
}

export async function fetchPolymarketOddsForMatches(
  matches: Match[],
  teamsById: Map<TeamId, Team>
): Promise<Record<MatchId, MatchOdds>> {
  const response = await fetch(POLYMARKET_EVENTS_URL);
  if (!response.ok) {
    throw new Error(`Polymarket returned ${response.status}`);
  }
  const payload = await response.json();
  const events = Array.isArray(payload) ? payload : Array.isArray(payload.events) ? payload.events : [];
  return normalizePolymarketEvents(events, matches, teamsById, new Date().toISOString());
}

export function normalizePolymarketEvents(
  events: PolymarketEvent[],
  matches: Match[],
  teamsById: Map<TeamId, Team>,
  fetchedAt: string
): Record<MatchId, MatchOdds> {
  const groupMatches = matches.filter((match) => match.phase === 'group-stage');
  const mutable = new Map<MatchId, MutableOdds>();

  for (const event of events) {
    for (const match of groupMatches) {
      if (!eventMatchesFixture(event, match, teamsById)) {
        continue;
      }
      const next = mutable.get(match.id) ?? {
        provider: 'Polymarket',
        fetchedAt,
        sourceUrl: event.slug ? `https://polymarket.com/event/${event.slug}` : 'https://polymarket.com'
      };
      readEventMarkets(event, match, teamsById, next);
      mutable.set(match.id, next);
    }
  }

  return Object.fromEntries(
    [...mutable.entries()]
      .map(([matchId, odds]) => [matchId, toMatchOdds(odds)] as const)
      .filter((entry): entry is readonly [MatchId, MatchOdds] => Boolean(entry[1]?.moneyline || entry[1]?.totalGoals))
  );
}

function readEventMarkets(event: PolymarketEvent, match: Match, teamsById: Map<TeamId, Team>, odds: MutableOdds) {
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);
  if (!home || !away) {
    return;
  }

  for (const market of event.markets ?? []) {
    const prices = market.outcomes && market.outcomePrices ? normalizePolymarketPrices(market.outcomes, market.outcomePrices) : {};
    const yes = findOutcome(prices, 'yes');
    const over = findOutcome(prices, 'over');
    const under = findOutcome(prices, 'under');
    const question = normalizeText(market.question ?? '');

    if (yes !== undefined) {
      if (question.includes('draw')) {
        odds.draw = yes;
      } else if (mentionsTeam(question, home)) {
        odds.homeWin = yes;
      } else if (mentionsTeam(question, away)) {
        odds.awayWin = yes;
      }
    }

    const totalLine = extractTotalLine(market.question ?? '');
    if (totalLine !== undefined && (over !== undefined || under !== undefined)) {
      const volume = Number(market.volume ?? 0);
      if (!odds.total || volume > odds.total.volume) {
        odds.total = {
          line: totalLine,
          over,
          under,
          volume: Number.isFinite(volume) ? volume : 0
        };
      }
    }
  }
}

function toMatchOdds(odds: MutableOdds): MatchOdds | undefined {
  const moneyline =
    odds.homeWin !== undefined && odds.draw !== undefined && odds.awayWin !== undefined
      ? normalizeThreeWay(odds.homeWin, odds.draw, odds.awayWin)
      : undefined;

  return {
    provider: odds.provider,
    fetchedAt: odds.fetchedAt,
    sourceUrl: odds.sourceUrl,
    moneyline,
    totalGoals: odds.total
      ? {
          line: odds.total.line,
          over: odds.total.over,
          under: odds.total.under
        }
      : undefined,
    confidence: moneyline && odds.total ? 'high' : moneyline ? 'medium' : 'low'
  };
}

function normalizeThreeWay(homeWin: number, draw: number, awayWin: number) {
  const total = homeWin + draw + awayWin;
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total
  };
}

function eventMatchesFixture(event: PolymarketEvent, match: Match, teamsById: Map<TeamId, Team>) {
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);
  if (!home || !away) {
    return false;
  }

  const text = normalizeText(`${event.title ?? ''} ${event.slug ?? ''}`);
  const date = match.kickoffUtc.slice(0, 10);
  return text.includes(date) && mentionsTeam(text, home) && mentionsTeam(text, away);
}

function mentionsTeam(text: string, team: Team) {
  return teamAliases(team).some((alias) => alias.length > 1 && text.includes(alias));
}

function teamAliases(team: Team) {
  return [team.name, team.abbreviation]
    .map(normalizeText)
    .flatMap((alias) => [alias, alias.replace(/\s+/g, '-')])
    .filter(Boolean);
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findOutcome(prices: Record<string, number>, outcome: string) {
  const key = Object.keys(prices).find((candidate) => normalizeText(candidate) === outcome);
  return key ? prices[key] : undefined;
}

function extractTotalLine(question: string) {
  const match = /O\/U\s+(\d+(?:\.\d+)?)/i.exec(question);
  if (!match) {
    return undefined;
  }
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : undefined;
}
