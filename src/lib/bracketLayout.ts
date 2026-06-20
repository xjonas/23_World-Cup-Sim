import { BRACKET_SOURCES } from '../data/constants';
import type { BracketMatch, MatchId, Phase } from '../types';

export interface BracketLayoutItem {
  matchId: MatchId;
  phase: Phase;
  column: number;
  rowStart: number;
  rowSpan: number;
  center: number;
}

export interface BracketLayoutConnector {
  matchId: MatchId;
  column: number;
  rowStart: number;
  rowSpan: number;
  topPercent: number;
  middlePercent: number;
  bottomPercent: number;
}

export interface BracketLayout {
  items: Record<MatchId, BracketLayoutItem>;
  connectors: BracketLayoutConnector[];
  rows: number;
  columns: number;
}

const PHASE_COLUMNS: Partial<Record<Phase, number>> = {
  'round-of-32': 1,
  'round-of-16': 3,
  quarterfinals: 5,
  semifinals: 7,
  final: 9,
  '3rd-place-match': 9
};

const ROW_STEP = 8;
const ROW_SPAN = 7;
const HALF_SPAN = ROW_SPAN / 2;

export function buildBracketLayout(bracket: BracketMatch[]): BracketLayout {
  const byId = new Map(bracket.map((match) => [match.match.id, match]));
  const items: Record<MatchId, BracketLayoutItem> = {};
  const final = bracket.find((match) => match.match.phase === 'final');
  const leaves = final ? walkLeaves(final.match.id, byId, []) : [];

  for (const match of bracket.filter((entry) => entry.match.phase === 'round-of-32').sort(compareByKickoff)) {
    if (!leaves.includes(match.match.id)) {
      leaves.push(match.match.id);
    }
  }

  leaves.forEach((matchId, index) => {
    const match = byId.get(matchId);
    if (match) {
      addItem(items, match, index * ROW_STEP + HALF_SPAN + 1);
    }
  });

  for (const phase of ['round-of-16', 'quarterfinals', 'semifinals', 'final'] satisfies Phase[]) {
    for (const match of bracket.filter((entry) => entry.match.phase === phase).sort(compareByKickoff)) {
      const sourceCenters = sourceMatchIds(match.match.id)
        .map((sourceId) => items[sourceId]?.center)
        .filter((center): center is number => center !== undefined);
      const center = sourceCenters.length ? average(sourceCenters) : nextOpenCenter(items);
      addItem(items, match, center);
    }
  }

  const finalItem = final ? items[final.match.id] : undefined;
  for (const match of bracket.filter((entry) => entry.match.phase === '3rd-place-match')) {
    addItem(items, match, (finalItem?.center ?? nextOpenCenter(items)) + ROW_STEP * 2);
  }

  const connectors = bracket
    .filter((match) => match.match.phase !== 'round-of-32' && match.match.phase !== '3rd-place-match')
    .map((match) => buildConnector(match.match.id, items))
    .filter((connector): connector is BracketLayoutConnector => Boolean(connector));
  const rows = Math.max(...Object.values(items).map((item) => item.rowStart + item.rowSpan + 1), ROW_SPAN + 2);

  return {
    items,
    connectors,
    rows,
    columns: 9
  };
}

function addItem(items: Record<MatchId, BracketLayoutItem>, bracketMatch: BracketMatch, center: number) {
  items[bracketMatch.match.id] = {
    matchId: bracketMatch.match.id,
    phase: bracketMatch.match.phase,
    column: PHASE_COLUMNS[bracketMatch.match.phase] ?? 1,
    rowStart: Math.max(1, Math.round(center - HALF_SPAN)),
    rowSpan: ROW_SPAN,
    center
  };
}

function walkLeaves(matchId: MatchId, byId: Map<MatchId, BracketMatch>, leaves: MatchId[]) {
  const match = byId.get(matchId);
  if (!match) {
    return leaves;
  }
  const sources = sourceMatchIds(matchId);
  if (match.match.phase === 'round-of-32' || !sources.length) {
    leaves.push(matchId);
    return leaves;
  }
  for (const sourceId of sources) {
    walkLeaves(sourceId, byId, leaves);
  }
  return leaves;
}

function buildConnector(matchId: MatchId, items: Record<MatchId, BracketLayoutItem>): BracketLayoutConnector | null {
  const item = items[matchId];
  const sources = sourceMatchIds(matchId).map((sourceId) => items[sourceId]).filter(Boolean);
  if (!item || sources.length !== 2) {
    return null;
  }

  const top = Math.min(sources[0].center, sources[1].center);
  const bottom = Math.max(sources[0].center, sources[1].center);
  const rowStart = Math.floor(top);
  const rowSpan = Math.max(2, Math.ceil(bottom - top) + 1);

  return {
    matchId,
    column: item.column - 1,
    rowStart,
    rowSpan,
    topPercent: ((top - rowStart) / rowSpan) * 100,
    middlePercent: ((item.center - rowStart) / rowSpan) * 100,
    bottomPercent: ((bottom - rowStart) / rowSpan) * 100
  };
}

function sourceMatchIds(matchId: MatchId) {
  return (BRACKET_SOURCES[matchId] ?? [])
    .filter((source) => source.type === 'winnerOf' || source.type === 'loserOf')
    .map((source) => source.matchId);
}

function nextOpenCenter(items: Record<MatchId, BracketLayoutItem>) {
  const centers = Object.values(items).map((item) => item.center);
  return centers.length ? Math.max(...centers) + ROW_STEP : HALF_SPAN + 1;
}

function compareByKickoff(a: BracketMatch, b: BracketMatch) {
  return a.match.kickoffUtc.localeCompare(b.match.kickoffUtc);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
