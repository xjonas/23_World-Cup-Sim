import { GROUPS } from '../data/constants';
import type {
  GroupLetter,
  GroupRanking,
  GroupStanding,
  Match,
  Score,
  SimulationState,
  TeamId,
  ThirdPlaceEntry,
  ThirdPlaceRanking
} from '../types';

function emptyStanding(teamId: TeamId, group: GroupLetter): GroupStanding {
  return {
    teamId,
    group,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    tieStatus: 'clear'
  };
}

export function getEffectiveScore(match: Match, state: SimulationState): Score | null {
  if (match.completed && match.apiScore) {
    return match.apiScore;
  }
  return state.scoreOverrides[match.id] ?? match.apiScore;
}

export function buildGroupRankings(matches: Match[], state: SimulationState): Record<GroupLetter, GroupRanking> {
  const rankings = {} as Record<GroupLetter, GroupRanking>;

  for (const group of GROUPS) {
    const groupMatches = matches.filter((match) => match.phase === 'group-stage' && match.group === group);
    const teamIds = new Set<TeamId>();
    for (const match of groupMatches) {
      teamIds.add(match.homeTeamId);
      teamIds.add(match.awayTeamId);
    }

    const standingsByTeam = new Map([...teamIds].map((teamId) => [teamId, emptyStanding(teamId, group)]));
    for (const match of groupMatches) {
      const score = getEffectiveScore(match, state);
      if (!score) {
        continue;
      }
      applyMatchResult(standingsByTeam.get(match.homeTeamId), score.home, score.away);
      applyMatchResult(standingsByTeam.get(match.awayTeamId), score.away, score.home);
    }

    rankings[group] = rankGroup(group, [...standingsByTeam.values()], groupMatches, state, state.manualGroupOrders[group] ?? []);
  }

  return rankings;
}

function applyMatchResult(standing: GroupStanding | undefined, goalsFor: number, goalsAgainst: number) {
  if (!standing) {
    return;
  }
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  standing.goalDifference = standing.goalsFor - standing.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    standing.wins += 1;
    standing.points += 3;
  } else if (goalsFor < goalsAgainst) {
    standing.losses += 1;
  } else {
    standing.draws += 1;
    standing.points += 1;
  }
}

function rankGroup(
  group: GroupLetter,
  standings: GroupStanding[],
  matches: Match[],
  state: SimulationState,
  manualOrder: TeamId[]
): GroupRanking {
  const pointGroups = groupByEqual(standings, (standing) => standing.points);
  const ordered: GroupStanding[] = [];
  const unresolvedTies: TeamId[][] = [];

  for (const pointGroup of pointGroups.sort((a, b) => b[0].points - a[0].points)) {
    const ranked = rankTieCluster(pointGroup, matches, state, manualOrder);
    ordered.push(...ranked.standings);
    unresolvedTies.push(...ranked.unresolvedTies);
  }

  return { group, standings: ordered, unresolvedTies };
}

function rankTieCluster(
  standings: GroupStanding[],
  matches: Match[],
  state: SimulationState,
  manualOrder: TeamId[]
): { standings: GroupStanding[]; unresolvedTies: TeamId[][] } {
  if (standings.length <= 1) {
    return { standings, unresolvedTies: [] };
  }

  const h2h = buildHeadToHeadStandings(standings, matches, state);
  const h2hGroups = groupByComparator(standings, (a, b) => compareHeadToHead(h2h.get(a.teamId), h2h.get(b.teamId)));
  if (h2hGroups.length > 1) {
    const ordered: GroupStanding[] = [];
    const unresolved: TeamId[][] = [];
    for (const group of h2hGroups) {
      const ranked = rankTieCluster(group, matches, state, manualOrder);
      ordered.push(...ranked.standings);
      unresolved.push(...ranked.unresolvedTies);
    }
    return { standings: ordered, unresolvedTies: unresolved };
  }

  const overallGroups = groupByComparator(standings, compareOverall);
  if (overallGroups.length > 1) {
    const ordered: GroupStanding[] = [];
    const unresolved: TeamId[][] = [];
    for (const group of overallGroups) {
      if (group.length === 1) {
        ordered.push(group[0]);
      } else {
        const manuallyOrdered = applyManualOrder(group, manualOrder);
        ordered.push(...manuallyOrdered);
        const isManual = hasCompleteManualOrder(group, manualOrder);
        for (const standing of manuallyOrdered) {
          standing.tieStatus = isManual ? 'manual' : 'unresolved';
        }
        if (!isManual) {
          unresolved.push(manuallyOrdered.map((standing) => standing.teamId));
        }
      }
    }
    return { standings: ordered, unresolvedTies: unresolved };
  }

  const manuallyOrdered = applyManualOrder(standings, manualOrder);
  const isManual = hasCompleteManualOrder(standings, manualOrder);
  for (const standing of manuallyOrdered) {
    standing.tieStatus = isManual ? 'manual' : 'unresolved';
  }
  return {
    standings: manuallyOrdered,
    unresolvedTies: isManual ? [] : [manuallyOrdered.map((standing) => standing.teamId)]
  };
}

function buildHeadToHeadStandings(standings: GroupStanding[], matches: Match[], state: SimulationState) {
  const teamIds = new Set(standings.map((standing) => standing.teamId));
  const h2h = new Map(standings.map((standing) => [standing.teamId, emptyStanding(standing.teamId, standing.group)]));

  for (const match of matches) {
    if (!teamIds.has(match.homeTeamId) || !teamIds.has(match.awayTeamId)) {
      continue;
    }
    const score = getEffectiveScore(match, state);
    if (!score) {
      continue;
    }
    applyMatchResult(h2h.get(match.homeTeamId), score.home, score.away);
    applyMatchResult(h2h.get(match.awayTeamId), score.away, score.home);
  }

  return h2h;
}

function compareHeadToHead(a?: GroupStanding, b?: GroupStanding) {
  if (!a || !b) {
    return 0;
  }
  return compareNumbers(b.points, a.points) || compareNumbers(b.goalDifference, a.goalDifference) || compareNumbers(b.goalsFor, a.goalsFor);
}

function compareOverall(a: GroupStanding, b: GroupStanding) {
  return compareNumbers(b.goalDifference, a.goalDifference) || compareNumbers(b.goalsFor, a.goalsFor);
}

function compareThirdPlace(a: ThirdPlaceEntry, b: ThirdPlaceEntry) {
  return compareNumbers(b.points, a.points) || compareNumbers(b.goalDifference, a.goalDifference) || compareNumbers(b.goalsFor, a.goalsFor);
}

function compareNumbers(a: number, b: number) {
  return a === b ? 0 : a > b ? 1 : -1;
}

function groupByEqual<T>(items: T[], value: (item: T) => number) {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const key = value(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function groupByComparator<T>(items: T[], comparator: (a: T, b: T) => number) {
  const sorted = [...items].sort(comparator);
  const groups: T[][] = [];
  for (const item of sorted) {
    const group = groups[groups.length - 1];
    if (!group || comparator(group[0], item) !== 0) {
      groups.push([item]);
    } else {
      group.push(item);
    }
  }
  return groups;
}

function applyManualOrder<T extends { teamId: TeamId }>(items: T[], manualOrder: TeamId[]) {
  return [...items].sort((a, b) => {
    const aIndex = manualOrder.indexOf(a.teamId);
    const bIndex = manualOrder.indexOf(b.teamId);
    if (aIndex >= 0 || bIndex >= 0) {
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.teamId.localeCompare(b.teamId);
  });
}

function hasCompleteManualOrder<T extends { teamId: TeamId }>(items: T[], manualOrder: TeamId[]) {
  return items.every((item) => manualOrder.includes(item.teamId));
}

export function buildThirdPlaceRanking(
  rankings: Record<GroupLetter, GroupRanking>,
  manualThirdPlaceOrder: GroupLetter[]
): ThirdPlaceRanking {
  const entries = GROUPS.map((group) => {
    const third = rankings[group].standings[2];
    return third ? ({ ...third, sourceRank: 3 } satisfies ThirdPlaceEntry) : null;
  }).filter((entry): entry is ThirdPlaceEntry => Boolean(entry));

  const groups = groupByComparator(entries, compareThirdPlace);
  const ordered: ThirdPlaceEntry[] = [];
  const unresolvedTies: GroupLetter[][] = [];

  for (const group of groups) {
    if (group.length === 1) {
      ordered.push(group[0]);
      continue;
    }
    const manual = [...group].sort((a, b) => {
      const aIndex = manualThirdPlaceOrder.indexOf(a.group);
      const bIndex = manualThirdPlaceOrder.indexOf(b.group);
      if (aIndex >= 0 || bIndex >= 0) {
        return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
      }
      return a.group.localeCompare(b.group);
    });
    const isManual = manual.every((entry) => manualThirdPlaceOrder.includes(entry.group));
    ordered.push(...manual.map((entry) => ({ ...entry, tieStatus: isManual ? 'manual' : 'unresolved' }) as ThirdPlaceEntry));
    if (!isManual) {
      unresolvedTies.push(manual.map((entry) => entry.group));
    }
  }

  return {
    entries: ordered,
    qualifiedGroups: ordered.slice(0, 8).map((entry) => entry.group),
    unresolvedTies
  };
}
