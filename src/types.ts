export type GroupLetter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L';

export type Phase =
  | 'group-stage'
  | 'round-of-32'
  | 'round-of-16'
  | 'quarterfinals'
  | 'semifinals'
  | '3rd-place-match'
  | 'final'
  | 'unknown';

export type ThirdPlaceColumn = '1A' | '1B' | '1D' | '1E' | '1G' | '1I' | '1K' | '1L';

export type TeamId = string;
export type MatchId = string;

export interface Team {
  id: TeamId;
  name: string;
  abbreviation: string;
  logoUrl: string;
  color?: string;
  isPlaceholder?: boolean;
}

export interface Score {
  home: number;
  away: number;
}

export type OddsConfidence = 'high' | 'medium' | 'low';

export interface MoneylineProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface TotalGoalsOdds {
  line: number;
  over?: number;
  under?: number;
}

export interface MatchOdds {
  provider: string;
  fetchedAt?: string;
  moneyline?: MoneylineProbabilities;
  totalGoals?: TotalGoalsOdds;
  confidence: OddsConfidence;
  sourceUrl?: string;
}

export interface Match {
  id: MatchId;
  phase: Phase;
  group?: GroupLetter;
  kickoffUtc: string;
  venue: string;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  apiScore: Score | null;
  status: string;
  statusDetail: string;
  completed: boolean;
  winnerTeamId?: TeamId;
  odds?: MatchOdds;
}

export interface TournamentData {
  fetchedAt: string;
  source: string;
  teams: Team[];
  matches: Match[];
}

export interface Profile {
  userId: string;
  displayName: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MatchPrediction {
  userId: string;
  matchId: MatchId;
  homeGoals: number;
  awayGoals: number;
  source: 'manual' | 'simulation';
  createdAt?: string;
  updatedAt?: string;
}

export type PredictionScoreCategory = 'exact' | 'goal-difference' | 'tendency' | 'wrong' | 'pending';

export interface PredictionScoreBreakdown {
  points: number;
  category: PredictionScoreCategory;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  totalPoints: number;
  exactScores: number;
  goalDifferences: number;
  tendencies: number;
  submittedPicks: number;
}

export interface GroupStanding {
  teamId: TeamId;
  group: GroupLetter;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  tieStatus: 'clear' | 'manual' | 'unresolved';
}

export interface GroupRanking {
  group: GroupLetter;
  standings: GroupStanding[];
  unresolvedTies: TeamId[][];
}

export interface ThirdPlaceEntry extends GroupStanding {
  sourceRank: number;
}

export interface ThirdPlaceRanking {
  entries: ThirdPlaceEntry[];
  qualifiedGroups: GroupLetter[];
  unresolvedTies: GroupLetter[][];
}

export interface SimulationState {
  scoreOverrides: Record<MatchId, Score>;
  scoreSources: Record<MatchId, 'manual' | 'simulation'>;
  simulationOdds: Record<MatchId, MatchOdds>;
  manualGroupOrders: Partial<Record<GroupLetter, TeamId[]>>;
  manualThirdPlaceOrder: GroupLetter[];
  manualKnockoutWinners: Record<MatchId, TeamId>;
  lastSyncedAt?: string;
  lastSimulatedAt?: string;
}

export type BracketSlot =
  | { type: 'winner'; group: GroupLetter }
  | { type: 'runnerUp'; group: GroupLetter }
  | { type: 'thirdColumn'; column: ThirdPlaceColumn; candidates: GroupLetter[] }
  | { type: 'winnerOf'; matchId: MatchId }
  | { type: 'loserOf'; matchId: MatchId }
  | { type: 'placeholder'; label: string };

export interface ThirdPlaceAssignment {
  '1A': GroupLetter;
  '1B': GroupLetter;
  '1D': GroupLetter;
  '1E': GroupLetter;
  '1G': GroupLetter;
  '1I': GroupLetter;
  '1K': GroupLetter;
  '1L': GroupLetter;
}

export interface BracketParticipant {
  source: BracketSlot;
  teamId: TeamId | null;
  label: string;
  pendingReason?: string;
}

export interface BracketMatch {
  match: Match;
  home: BracketParticipant;
  away: BracketParticipant;
  score: Score | null;
  winnerTeamId: TeamId | null;
  loserTeamId: TeamId | null;
  needsWinner: boolean;
}
