import type {
  LeaderboardRow,
  Match,
  MatchPrediction,
  PredictionScoreBreakdown,
  Profile,
  Score
} from '../types';

const EXACT_POINTS = 4;
const GOAL_DIFFERENCE_POINTS = 3;
const TENDENCY_POINTS = 2;

export function scorePrediction(
  prediction: Pick<MatchPrediction, 'homeGoals' | 'awayGoals'>,
  actual: Score | null
): PredictionScoreBreakdown {
  if (!actual) {
    return { points: 0, category: 'pending' };
  }

  if (prediction.homeGoals === actual.home && prediction.awayGoals === actual.away) {
    return { points: EXACT_POINTS, category: 'exact' };
  }

  const predictedDifference = prediction.homeGoals - prediction.awayGoals;
  const actualDifference = actual.home - actual.away;

  if (actualDifference === 0 && predictedDifference === 0) {
    return { points: TENDENCY_POINTS, category: 'tendency' };
  }

  if (actualDifference !== 0 && predictedDifference === actualDifference) {
    return { points: GOAL_DIFFERENCE_POINTS, category: 'goal-difference' };
  }

  if (Math.sign(predictedDifference) === Math.sign(actualDifference)) {
    return { points: TENDENCY_POINTS, category: 'tendency' };
  }

  return { points: 0, category: 'wrong' };
}

export function isPredictionLocked(match: Pick<Match, 'kickoffUtc'>, now: Date | string | number = Date.now()) {
  const kickoff = new Date(match.kickoffUtc).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(kickoff) || !Number.isFinite(current)) {
    return false;
  }
  return current >= kickoff;
}

export function buildLeaderboard(
  profiles: Profile[],
  predictions: MatchPrediction[],
  matches: Match[]
): LeaderboardRow[] {
  const profilesByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const userIds = new Set([...profiles.map((profile) => profile.userId), ...predictions.map((prediction) => prediction.userId)]);
  const rows = [...userIds].map((userId) => ({
    rank: 0,
    userId,
    displayName: profilesByUser.get(userId)?.displayName || 'Unnamed player',
    totalPoints: 0,
    exactScores: 0,
    goalDifferences: 0,
    tendencies: 0,
    submittedPicks: 0
  }));
  const rowsByUser = new Map(rows.map((row) => [row.userId, row]));

  for (const prediction of predictions) {
    const row = rowsByUser.get(prediction.userId);
    if (!row) {
      continue;
    }

    row.submittedPicks += 1;
    const match = matchById.get(prediction.matchId);
    if (!match?.completed || !match.apiScore) {
      continue;
    }

    const breakdown = scorePrediction(prediction, match.apiScore);
    row.totalPoints += breakdown.points;
    if (breakdown.category === 'exact') {
      row.exactScores += 1;
    } else if (breakdown.category === 'goal-difference') {
      row.goalDifferences += 1;
    } else if (breakdown.category === 'tendency') {
      row.tendencies += 1;
    }
  }

  rows.sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.exactScores - a.exactScores ||
      b.goalDifferences - a.goalDifferences ||
      b.tendencies - a.tendencies ||
      a.displayName.localeCompare(b.displayName)
  );

  let previous: LeaderboardRow | null = null;
  let rank = 0;
  return rows.map((row, index) => {
    const tied =
      previous &&
      previous.totalPoints === row.totalPoints &&
      previous.exactScores === row.exactScores &&
      previous.goalDifferences === row.goalDifferences &&
      previous.tendencies === row.tendencies;
    rank = tied ? rank : index + 1;
    previous = row;
    return { ...row, rank };
  });
}

export function predictionToScore(prediction: MatchPrediction | undefined): Score | null {
  return prediction ? { home: prediction.homeGoals, away: prediction.awayGoals } : null;
}
