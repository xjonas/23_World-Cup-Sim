import { BRACKET_SOURCES, KNOCKOUT_GAME_LABELS, KNOCKOUT_PHASES } from '../data/constants';
import { THIRD_PLACE_MAP } from '../data/thirdPlaceMap';
import type {
  BracketMatch,
  BracketParticipant,
  BracketSlot,
  GroupLetter,
  GroupRanking,
  Match,
  MatchId,
  SimulationState,
  Team,
  TeamId,
  ThirdPlaceAssignment,
  ThirdPlaceRanking
} from '../types';
import { getEffectiveScore } from './standings';

export function getThirdPlaceAssignment(groups: GroupLetter[]): ThirdPlaceAssignment | null {
  if (groups.length !== 8) {
    return null;
  }
  const map = THIRD_PLACE_MAP as Record<string, ThirdPlaceAssignment>;
  return map[[...groups].sort().join('')] ?? null;
}

export function buildBracket(
  matches: Match[],
  teamsById: Map<TeamId, Team>,
  rankings: Record<GroupLetter, GroupRanking>,
  thirdPlaceRanking: ThirdPlaceRanking,
  state: SimulationState
): BracketMatch[] {
  const assignment = getThirdPlaceAssignment(thirdPlaceRanking.qualifiedGroups);
  const resolved = new Map<MatchId, BracketMatch>();
  const knockoutMatches = matches
    .filter((match) => KNOCKOUT_PHASES.includes(match.phase))
    .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));

  for (const match of knockoutMatches) {
    const sources = BRACKET_SOURCES[match.id] ?? [
      { type: 'placeholder', label: teamsById.get(match.homeTeamId)?.name ?? 'TBD' },
      { type: 'placeholder', label: teamsById.get(match.awayTeamId)?.name ?? 'TBD' }
    ];
    const home = resolveSlot(sources[0], teamsById, rankings, assignment, resolved);
    const away = resolveSlot(sources[1], teamsById, rankings, assignment, resolved);
    const score = getEffectiveScore(match, state);
    const manualWinner = state.manualKnockoutWinners[match.id];
    const winnerTeamId = resolveWinner(match, home, away, score, manualWinner);
    const loserTeamId = winnerTeamId ? (winnerTeamId === home.teamId ? away.teamId : home.teamId) : null;
    const needsWinner = Boolean(home.teamId && away.teamId && (!winnerTeamId || (score && score.home === score.away)));

    const bracketMatch: BracketMatch = {
      match,
      home,
      away,
      score,
      winnerTeamId,
      loserTeamId,
      needsWinner
    };

    resolved.set(match.id, bracketMatch);
  }

  return [...resolved.values()];
}

function resolveWinner(
  match: Match,
  home: BracketParticipant,
  away: BracketParticipant,
  score: { home: number; away: number } | null,
  manualWinner?: TeamId
) {
  if (manualWinner && (manualWinner === home.teamId || manualWinner === away.teamId)) {
    return manualWinner;
  }
  if (score && home.teamId && away.teamId && score.home !== score.away) {
    return score.home > score.away ? home.teamId : away.teamId;
  }
  if (match.winnerTeamId && (match.winnerTeamId === home.teamId || match.winnerTeamId === away.teamId)) {
    return match.winnerTeamId;
  }
  return null;
}

function resolveSlot(
  source: BracketSlot,
  teamsById: Map<TeamId, Team>,
  rankings: Record<GroupLetter, GroupRanking>,
  assignment: ThirdPlaceAssignment | null,
  previousMatches: Map<MatchId, BracketMatch>
): BracketParticipant {
  if (source.type === 'winner') {
    return fromGroupRank(source, rankings[source.group]?.standings[0]?.teamId, teamsById, `Winner Group ${source.group}`);
  }
  if (source.type === 'runnerUp') {
    return fromGroupRank(source, rankings[source.group]?.standings[1]?.teamId, teamsById, `Runner-up Group ${source.group}`);
  }
  if (source.type === 'thirdColumn') {
    const group = assignment?.[source.column];
    const teamId = group ? rankings[group]?.standings[2]?.teamId ?? null : null;
    return {
      source,
      teamId,
      label: teamId ? teamsById.get(teamId)?.name ?? `3rd Group ${group}` : `3rd Group ${source.candidates.join('/')}`,
      pendingReason: group ? undefined : 'Waiting for all best third-place qualifiers'
    };
  }
  if (source.type === 'winnerOf' || source.type === 'loserOf') {
    const previous = previousMatches.get(source.matchId);
    const teamId = source.type === 'winnerOf' ? previous?.winnerTeamId ?? null : previous?.loserTeamId ?? null;
    const sourceLabel = KNOCKOUT_GAME_LABELS[source.matchId] ?? 'previous knockout game';
    const role = source.type === 'winnerOf' ? 'Winner' : 'Loser';
    return {
      source,
      teamId,
      label: teamId ? teamsById.get(teamId)?.name ?? 'TBD' : `${role} of ${sourceLabel}`,
      pendingReason: teamId ? undefined : `Waiting for ${sourceLabel}`
    };
  }
  return { source, teamId: null, label: source.label, pendingReason: 'Pending' };
}

function fromGroupRank(source: BracketSlot, teamId: TeamId | null, teamsById: Map<TeamId, Team>, fallback: string) {
  return {
    source,
    teamId,
    label: teamId ? teamsById.get(teamId)?.name ?? fallback : fallback,
    pendingReason: teamId ? undefined : fallback
  };
}
