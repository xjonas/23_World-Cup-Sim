import { KNOCKOUT_PHASES } from '../data/constants';
import type { Match, MatchId, MatchOdds, Score, SimulationState, Team, TeamId } from '../types';

export interface GroupSimulationResult {
  state: SimulationState;
  simulatedCount: number;
  oddsBackedCount: number;
  fallbackCount: number;
  skippedManualCount: number;
  skippedCompletedCount: number;
}

export interface GroupSimulationOptions {
  externalOdds?: Record<MatchId, MatchOdds>;
  seed?: number;
  now?: string;
}

interface TeamStrength {
  value: number;
  count: number;
}

interface SimulationOdds {
  odds: MatchOdds;
  backedByMarket: boolean;
}

const DEFAULT_DRAW_PROBABILITY = 0.27;
const DEFAULT_TOTAL_GOALS = 2.55;

export function simulateGroupStage(
  matches: Match[],
  teamsById: Map<TeamId, Team>,
  state: SimulationState,
  options: GroupSimulationOptions = {}
): GroupSimulationResult {
  const random = createSeededRandom(options.seed ?? Date.now());
  const strengths = buildTeamStrengths(matches, options.externalOdds ?? {});
  const scoreOverrides = { ...state.scoreOverrides };
  const scoreSources = { ...state.scoreSources };
  const simulationOddsByMatch = { ...state.simulationOdds };
  let simulatedCount = 0;
  let oddsBackedCount = 0;
  let fallbackCount = 0;
  let skippedManualCount = 0;
  let skippedCompletedCount = 0;

  for (const match of matches) {
    if (match.phase !== 'group-stage') {
      continue;
    }
    if (match.completed || match.apiScore) {
      skippedCompletedCount += 1;
      continue;
    }
    if (scoreOverrides[match.id] && scoreSources[match.id] !== 'simulation') {
      skippedManualCount += 1;
      continue;
    }

    const simulationOdds = getSimulationOdds(match, teamsById, strengths, options.externalOdds ?? {});
    scoreOverrides[match.id] = simulateGroupMatchScore(match, simulationOdds.odds, random);
    scoreSources[match.id] = 'simulation';
    simulationOddsByMatch[match.id] = simulationOdds.odds;
    simulatedCount += 1;
    if (simulationOdds.backedByMarket) {
      oddsBackedCount += 1;
    } else {
      fallbackCount += 1;
    }
  }

  return {
    state: {
      ...state,
      scoreOverrides,
      scoreSources,
      simulationOdds: simulationOddsByMatch,
      lastSimulatedAt: options.now ?? new Date().toISOString()
    },
    simulatedCount,
    oddsBackedCount,
    fallbackCount,
    skippedManualCount,
    skippedCompletedCount
  };
}

export function clearSimulatedGroupStageScores(matches: Match[], state: SimulationState): SimulationState {
  const groupMatchIds = new Set(matches.filter((match) => match.phase === 'group-stage').map((match) => match.id));
  const scoreOverrides = { ...state.scoreOverrides };
  const scoreSources = { ...state.scoreSources };
  const simulationOdds = { ...state.simulationOdds };

  for (const [matchId, source] of Object.entries(scoreSources)) {
    if (source === 'simulation' && groupMatchIds.has(matchId)) {
      delete scoreOverrides[matchId];
      delete scoreSources[matchId];
      delete simulationOdds[matchId];
    }
  }

  return {
    ...state,
    scoreOverrides,
    scoreSources,
    simulationOdds,
    lastSimulatedAt: undefined
  };
}

export function clearManualBracketEntries(matches: Match[], state: SimulationState): SimulationState {
  const bracketMatchIds = new Set(matches.filter((match) => KNOCKOUT_PHASES.includes(match.phase)).map((match) => match.id));
  const scoreOverrides = { ...state.scoreOverrides };
  const scoreSources = { ...state.scoreSources };
  const simulationOdds = { ...state.simulationOdds };
  const manualKnockoutWinners = { ...state.manualKnockoutWinners };

  for (const matchId of bracketMatchIds) {
    delete scoreOverrides[matchId];
    delete scoreSources[matchId];
    delete simulationOdds[matchId];
    delete manualKnockoutWinners[matchId];
  }

  return {
    ...state,
    scoreOverrides,
    scoreSources,
    simulationOdds,
    manualKnockoutWinners
  };
}

export function simulateGroupMatchScore(match: Match, odds: MatchOdds, random: () => number = Math.random): Score {
  const moneyline = softenMoneyline(odds.moneyline, odds.confidence);
  const outcomeRoll = random();
  const targetOutcome =
    outcomeRoll < moneyline.homeWin ? 'home' : outcomeRoll < moneyline.homeWin + moneyline.draw ? 'draw' : 'away';
  const totalGoals = estimateTotalGoals(odds);
  const homeShare = clamp(0.5 + ((moneyline.homeWin / (moneyline.homeWin + moneyline.awayWin || 1)) - 0.5) * 0.72, 0.18, 0.82);
  const expectedHome = Math.max(0.15, totalGoals * homeShare);
  const expectedAway = Math.max(0.15, totalGoals - expectedHome);

  let home = poisson(expectedHome, random);
  let away = poisson(expectedAway, random);

  if (targetOutcome === 'draw') {
    const drawGoals = clamp(Math.round((home + away) / 2), 0, 4);
    return { home: drawGoals, away: drawGoals };
  }

  if (targetOutcome === 'home' && home <= away) {
    home = away + 1;
  }
  if (targetOutcome === 'away' && away <= home) {
    away = home + 1;
  }

  return {
    home: Math.min(home, 9),
    away: Math.min(away, 9)
  };
}

function getSimulationOdds(
  match: Match,
  teamsById: Map<TeamId, Team>,
  strengths: Map<TeamId, TeamStrength>,
  externalOdds: Record<MatchId, MatchOdds>
): SimulationOdds {
  const direct = match.odds?.moneyline ? match.odds : externalOdds[match.id]?.moneyline ? externalOdds[match.id] : undefined;
  if (direct) {
    return { odds: direct, backedByMarket: true };
  }
  return {
    odds: buildFallbackOdds(match, teamsById, strengths),
    backedByMarket: false
  };
}

function buildTeamStrengths(matches: Match[], externalOdds: Record<MatchId, MatchOdds>) {
  const strengths = new Map<TeamId, TeamStrength>();

  for (const match of matches) {
    if (match.phase !== 'group-stage') {
      continue;
    }
    const moneyline = match.odds?.moneyline ?? externalOdds[match.id]?.moneyline;
    if (!moneyline) {
      continue;
    }
    const edge = Math.log((moneyline.homeWin + 0.02) / (moneyline.awayWin + 0.02));
    addStrength(strengths, match.homeTeamId, edge);
    addStrength(strengths, match.awayTeamId, -edge);
  }

  return strengths;
}

function addStrength(strengths: Map<TeamId, TeamStrength>, teamId: TeamId, value: number) {
  const current = strengths.get(teamId) ?? { value: 0, count: 0 };
  strengths.set(teamId, { value: current.value + value, count: current.count + 1 });
}

function buildFallbackOdds(match: Match, teamsById: Map<TeamId, Team>, strengths: Map<TeamId, TeamStrength>): MatchOdds {
  const homeRating = averageStrength(strengths.get(match.homeTeamId));
  const awayRating = averageStrength(strengths.get(match.awayTeamId));
  const homeNoDraw = 1 / (1 + Math.exp(-(homeRating - awayRating) * 0.85));
  const draw = DEFAULT_DRAW_PROBABILITY;
  const winPool = 1 - draw;

  return {
    provider: 'Fallback strength model',
    moneyline: {
      homeWin: winPool * homeNoDraw,
      draw,
      awayWin: winPool * (1 - homeNoDraw)
    },
    totalGoals: {
      line: teamsById.has(match.homeTeamId) && teamsById.has(match.awayTeamId) ? DEFAULT_TOTAL_GOALS : 2.35
    },
    confidence: 'low'
  };
}

function averageStrength(strength: TeamStrength | undefined) {
  return strength && strength.count ? strength.value / strength.count : 0;
}

function softenMoneyline(moneyline: MatchOdds['moneyline'], confidence: MatchOdds['confidence']) {
  const base = moneyline ?? {
    homeWin: 0.365,
    draw: DEFAULT_DRAW_PROBABILITY,
    awayWin: 0.365
  };
  const favoriteEdge = Math.abs(base.homeWin - base.awayWin);
  const blend = confidence === 'low' ? 0.18 : favoriteEdge < 0.08 ? 0.12 : 0.04;
  return {
    homeWin: base.homeWin * (1 - blend) + (1 / 3) * blend,
    draw: base.draw * (1 - blend) + (1 / 3) * blend,
    awayWin: base.awayWin * (1 - blend) + (1 / 3) * blend
  };
}

function estimateTotalGoals(odds: MatchOdds) {
  const total = odds.totalGoals;
  if (!total) {
    return DEFAULT_TOTAL_GOALS;
  }
  const over = total.over ?? 0.5;
  const under = total.under ?? 1 - over;
  return clamp(total.line + (over - under) * 0.9, 1.5, 5);
}

function poisson(lambda: number, random: () => number) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

function createSeededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
