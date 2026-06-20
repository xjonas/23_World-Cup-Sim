import { describe, expect, it } from 'vitest';
import type { GroupLetter, GroupRanking, Match, SimulationState, Team } from '../types';
import { BRACKET_SOURCES, KNOCKOUT_GAME_LABELS } from '../data/constants';
import { buildBracket, getThirdPlaceAssignment } from './bracket';
import { buildBracketLayout } from './bracketLayout';
import { normalizeAmericanOdds, normalizePolymarketPrices } from './odds';
import { buildLeaderboard, isPredictionLocked, scorePrediction } from './predictions';
import { clearSimulatedGroupStageScores, simulateGroupMatchScore, simulateGroupStage } from './simulation';
import { buildGroupRankings, buildThirdPlaceRanking, getEffectiveScore } from './standings';

const baseState: SimulationState = {
  scoreOverrides: {},
  scoreSources: {},
  simulationOdds: {},
  manualGroupOrders: {},
  manualThirdPlaceOrder: [],
  manualKnockoutWinners: {}
};

function groupMatch(id: string, group: GroupLetter, homeTeamId: string, awayTeamId: string, home: number, away: number): Match {
  return {
    id,
    phase: 'group-stage',
    group,
    kickoffUtc: `2026-06-${id.padStart(2, '0')}T12:00:00Z`,
    venue: 'Test Stadium',
    homeTeamId,
    awayTeamId,
    apiScore: { home, away },
    status: 'Full Time',
    statusDetail: 'FT',
    completed: true
  };
}

function knockoutMatch(id: string, phase: Match['phase'] = 'round-of-32'): Match {
  return {
    id,
    phase,
    kickoffUtc: '2026-06-30T12:00:00Z',
    venue: 'Test Stadium',
    homeTeamId: 'placeholder-home',
    awayTeamId: 'placeholder-away',
    apiScore: null,
    status: 'Scheduled',
    statusDetail: '',
    completed: false
  };
}

function fakeRankings(): Record<GroupLetter, GroupRanking> {
  const letters = 'ABCDEFGHIJKL'.split('') as GroupLetter[];
  return Object.fromEntries(
    letters.map((group) => [
      group,
      {
        group,
        unresolvedTies: [],
        standings: [1, 2, 3, 4].map((rank) => ({
          teamId: `${group}${rank}`,
          group,
          played: 3,
          wins: rank === 1 ? 3 : 0,
          draws: 0,
          losses: rank === 1 ? 0 : 3,
          goalsFor: 10 - rank,
          goalsAgainst: rank,
          goalDifference: 10 - rank * 2,
          points: 10 - rank,
          tieStatus: 'clear'
        }))
      }
    ])
  ) as unknown as Record<GroupLetter, GroupRanking>;
}

describe('group standings', () => {
  it('calculates points, goal difference and goals for', () => {
    const rankings = buildGroupRankings(
      [
        groupMatch('1', 'A', 'A1', 'A2', 2, 0),
        groupMatch('2', 'A', 'A3', 'A4', 1, 1),
        groupMatch('3', 'A', 'A1', 'A3', 0, 0)
      ],
      baseState
    );

    expect(rankings.A.standings[0]).toMatchObject({
      teamId: 'A1',
      points: 4,
      goalsFor: 2,
      goalsAgainst: 0,
      goalDifference: 2
    });
  });

  it('uses head-to-head before overall goal difference', () => {
    const rankings = buildGroupRankings(
      [
        groupMatch('1', 'A', 'A1', 'A2', 1, 0),
        groupMatch('2', 'A', 'A1', 'A3', 0, 1),
        groupMatch('3', 'A', 'A1', 'A4', 0, 0),
        groupMatch('4', 'A', 'A2', 'A3', 1, 0),
        groupMatch('5', 'A', 'A2', 'A4', 0, 0)
      ],
      baseState
    );

    expect(rankings.A.standings.map((standing) => standing.teamId).slice(0, 2)).toEqual(['A1', 'A2']);
  });

  it('flags unresolved score-based ties and accepts manual ordering', () => {
    const matches = [groupMatch('1', 'A', 'A1', 'A2', 0, 0)];
    const unresolved = buildGroupRankings(matches, baseState);
    expect(unresolved.A.unresolvedTies).toEqual([['A1', 'A2']]);

    const manual = buildGroupRankings(matches, {
      ...baseState,
      manualGroupOrders: { A: ['A2', 'A1'] }
    });
    expect(manual.A.standings.map((standing) => standing.teamId).slice(0, 2)).toEqual(['A2', 'A1']);
    expect(manual.A.standings[0].tieStatus).toBe('manual');
  });

  it('keeps ESPN final scores canonical over local overrides', () => {
    const match = groupMatch('1', 'A', 'A1', 'A2', 2, 0);
    expect(
      getEffectiveScore(match, {
        ...baseState,
        scoreOverrides: { '1': { home: 0, away: 5 } },
        scoreSources: { '1': 'manual' }
      })
    ).toEqual({ home: 2, away: 0 });
  });
});

describe('third-place ranking and bracket mapping', () => {
  it('loads the official 495-row third-place mapping for a known combination', () => {
    expect(getThirdPlaceAssignment(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'])).toMatchObject({
      '1A': 'E',
      '1B': 'J',
      '1D': 'I',
      '1E': 'F'
    });
  });

  it('ranks best third-place teams by points, goal difference and goals for', () => {
    const rankings = fakeRankings();
    for (const group of Object.values(rankings)) {
      group.standings[2].points = 1;
      group.standings[2].goalDifference = -2;
      group.standings[2].goalsFor = 1;
    }
    rankings.A.standings[2].points = 4;
    rankings.B.standings[2].points = 4;
    rankings.A.standings[2].goalDifference = 1;
    rankings.B.standings[2].goalDifference = 0;

    const third = buildThirdPlaceRanking(rankings, []);
    expect(third.entries[0].group).toBe('A');
    expect(third.entries[1].group).toBe('B');
  });

  it('fills round-of-32 third-place slots from the assignment table', () => {
    const rankings = fakeRankings();
    const third = {
      entries: [],
      qualifiedGroups: ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as GroupLetter[],
      unresolvedTies: []
    };
    const teams = new Map<string, Team>(
      ['A1', 'E3'].map((id) => [
        id,
        {
          id,
          name: id,
          abbreviation: id,
          logoUrl: ''
        }
      ])
    );

    const bracket = buildBracket([knockoutMatch('760491')], teams, rankings, third, baseState);
    expect(bracket[0].home.teamId).toBe('A1');
    expect(bracket[0].away.teamId).toBe('E3');
  });
});

describe('odds and group simulation', () => {
  it('converts betting odds into probabilities', () => {
    expect(normalizeAmericanOdds('-150')).toBeCloseTo(0.6);
    expect(normalizeAmericanOdds('+200')).toBeCloseTo(1 / 3);
    expect(normalizePolymarketPrices('["Yes","No"]', '["0.25","0.75"]')).toMatchObject({
      Yes: 0.25,
      No: 0.75
    });
  });

  it('generates deterministic scorelines from a seeded random source', () => {
    const odds = {
      provider: 'Test',
      confidence: 'high' as const,
      moneyline: { homeWin: 0.7, draw: 0.18, awayWin: 0.12 },
      totalGoals: { line: 2.5, over: 0.55, under: 0.45 }
    };
    const randomValues = [0.1, 0.4, 0.7, 0.8, 0.2, 0.9];
    const score = simulateGroupMatchScore(groupMatch('20', 'A', 'A1', 'A2', 0, 0), odds, () => randomValues.shift() ?? 0.5);
    expect(score.home).toBeGreaterThan(score.away);
  });

  it('preserves manual scores while replacing prior simulated scores', () => {
    const matches = [
      {
        ...groupMatch('20', 'A', 'A1', 'A2', 0, 0),
        completed: false,
        apiScore: null,
        odds: {
          provider: 'Test',
          confidence: 'high' as const,
          moneyline: { homeWin: 0.62, draw: 0.22, awayWin: 0.16 },
          totalGoals: { line: 2.5, over: 0.5, under: 0.5 }
        }
      },
      {
        ...groupMatch('21', 'A', 'A3', 'A4', 0, 0),
        completed: false,
        apiScore: null
      }
    ];
    const teams = new Map<string, Team>(
      ['A1', 'A2', 'A3', 'A4'].map((id) => [id, { id, name: id, abbreviation: id, logoUrl: '' }])
    );
    const result = simulateGroupStage(matches, teams, {
      ...baseState,
      scoreOverrides: { '21': { home: 4, away: 4 } },
      scoreSources: { '21': 'manual' }
    }, { seed: 123, now: '2026-06-20T00:00:00Z' });

    expect(result.state.scoreOverrides['21']).toEqual({ home: 4, away: 4 });
    expect(result.state.scoreSources['20']).toBe('simulation');
    expect(result.state.simulationOdds['20']).toMatchObject({ provider: 'Test' });
    expect(result.skippedManualCount).toBe(1);

    const cleared = clearSimulatedGroupStageScores(matches, result.state);
    expect(cleared.scoreOverrides['20']).toBeUndefined();
    expect(cleared.simulationOdds['20']).toBeUndefined();
    expect(cleared.scoreOverrides['21']).toEqual({ home: 4, away: 4 });
  });
});

describe('prediction scoring and locks', () => {
  it('awards 4 points for an exact score', () => {
    expect(scorePrediction({ homeGoals: 2, awayGoals: 0 }, { home: 2, away: 0 })).toEqual({
      points: 4,
      category: 'exact'
    });
  });

  it('awards 3 points for a correct non-draw goal difference', () => {
    expect(scorePrediction({ homeGoals: 3, awayGoals: 1 }, { home: 2, away: 0 })).toEqual({
      points: 3,
      category: 'goal-difference'
    });
  });

  it('awards 2 points for correct home, away, and draw tendencies', () => {
    expect(scorePrediction({ homeGoals: 1, awayGoals: 0 }, { home: 3, away: 0 })).toEqual({
      points: 2,
      category: 'tendency'
    });
    expect(scorePrediction({ homeGoals: 0, awayGoals: 1 }, { home: 1, away: 4 })).toEqual({
      points: 2,
      category: 'tendency'
    });
    expect(scorePrediction({ homeGoals: 0, awayGoals: 0 }, { home: 1, away: 1 })).toEqual({
      points: 2,
      category: 'tendency'
    });
  });

  it('awards 0 points for the wrong tendency', () => {
    expect(scorePrediction({ homeGoals: 1, awayGoals: 0 }, { home: 0, away: 2 })).toEqual({
      points: 0,
      category: 'wrong'
    });
  });

  it('locks predictions at kickoff', () => {
    const match = { kickoffUtc: '2026-06-20T17:00:00Z' };
    expect(isPredictionLocked(match, '2026-06-20T16:59:59Z')).toBe(false);
    expect(isPredictionLocked(match, '2026-06-20T17:00:00Z')).toBe(true);
  });

  it('builds leaderboard rows from visible predictions and completed scores', () => {
    const rows = buildLeaderboard(
      [{ userId: 'u1', displayName: 'Jonas' }],
      [
        { userId: 'u1', matchId: '1', homeGoals: 2, awayGoals: 0, source: 'manual' },
        { userId: 'u1', matchId: '2', homeGoals: 1, awayGoals: 0, source: 'manual' }
      ],
      [
        groupMatch('1', 'A', 'A1', 'A2', 2, 0),
        { ...groupMatch('2', 'A', 'A3', 'A4', 0, 0), completed: false, apiScore: null }
      ]
    );

    expect(rows[0]).toMatchObject({
      rank: 1,
      displayName: 'Jonas',
      totalPoints: 4,
      exactScores: 1,
      submittedPicks: 2
    });
  });
});

describe('bracket layout', () => {
  it('uses FIFA match-number order for knockout labels and round-of-16 sources', () => {
    expect(KNOCKOUT_GAME_LABELS['760489']).toBe('Round of 32 | Game 2');
    expect(KNOCKOUT_GAME_LABELS['760488']).toBe('Round of 32 | Game 3');
    expect(KNOCKOUT_GAME_LABELS['760487']).toBe('Round of 32 | Game 4');
    expect(BRACKET_SOURCES['760502']).toEqual([
      { type: 'winnerOf', matchId: '760486' },
      { type: 'winnerOf', matchId: '760488' }
    ]);
    expect(BRACKET_SOURCES['760503']).toEqual([
      { type: 'winnerOf', matchId: '760489' },
      { type: 'winnerOf', matchId: '760492' }
    ]);
    expect(BRACKET_SOURCES['760509']).toEqual([
      { type: 'winnerOf', matchId: '760500' },
      { type: 'winnerOf', matchId: '760499' }
    ]);
  });

  it('centers a later round between the two matches feeding it', () => {
    const rankings = fakeRankings();
    const third = {
      entries: [],
      qualifiedGroups: ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as GroupLetter[],
      unresolvedTies: []
    };
    const teams = new Map<string, Team>();
    const matches = [knockoutMatch('760486'), knockoutMatch('760488'), knockoutMatch('760502', 'round-of-16')];
    const bracket = buildBracket(matches, teams, rankings, third, baseState);
    const layout = buildBracketLayout(bracket);
    const first = layout.items['760486'];
    const second = layout.items['760488'];
    const next = layout.items['760502'];

    expect(next.center).toBe((first.center + second.center) / 2);
    expect(layout.connectors.some((connector) => connector.matchId === '760502')).toBe(true);
  });
});
