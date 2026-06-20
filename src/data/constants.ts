import type { BracketSlot, GroupLetter, MatchId, Phase, ThirdPlaceColumn } from '../types';

export const GROUPS: GroupLetter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export const PHASE_LABELS: Record<Phase, string> = {
  'group-stage': 'Group Stage',
  'round-of-32': 'Round of 32',
  'round-of-16': 'Round of 16',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  '3rd-place-match': 'Third Place',
  final: 'Final',
  unknown: 'Other'
};

export const PHASE_ORDER: Phase[] = [
  'group-stage',
  'round-of-32',
  'round-of-16',
  'quarterfinals',
  'semifinals',
  '3rd-place-match',
  'final'
];

export const KNOCKOUT_PHASES: Phase[] = [
  'round-of-32',
  'round-of-16',
  'quarterfinals',
  'semifinals',
  '3rd-place-match',
  'final'
];

export const THIRD_PLACE_CANDIDATES: Record<ThirdPlaceColumn, GroupLetter[]> = {
  '1A': ['C', 'E', 'F', 'H', 'I'],
  '1B': ['E', 'F', 'G', 'I', 'J'],
  '1D': ['B', 'E', 'F', 'I', 'J'],
  '1E': ['A', 'B', 'C', 'D', 'F'],
  '1G': ['A', 'E', 'H', 'I', 'J'],
  '1I': ['C', 'D', 'F', 'G', 'H'],
  '1K': ['D', 'E', 'I', 'J', 'L'],
  '1L': ['E', 'H', 'I', 'J', 'K']
};

export const BRACKET_SOURCES: Record<MatchId, [BracketSlot, BracketSlot]> = {
  '760486': [
    { type: 'runnerUp', group: 'A' },
    { type: 'runnerUp', group: 'B' }
  ],
  '760487': [
    { type: 'winner', group: 'C' },
    { type: 'runnerUp', group: 'F' }
  ],
  '760489': [
    { type: 'winner', group: 'E' },
    { type: 'thirdColumn', column: '1E', candidates: THIRD_PLACE_CANDIDATES['1E'] }
  ],
  '760488': [
    { type: 'winner', group: 'F' },
    { type: 'runnerUp', group: 'C' }
  ],
  '760490': [
    { type: 'runnerUp', group: 'E' },
    { type: 'runnerUp', group: 'I' }
  ],
  '760492': [
    { type: 'winner', group: 'I' },
    { type: 'thirdColumn', column: '1I', candidates: THIRD_PLACE_CANDIDATES['1I'] }
  ],
  '760491': [
    { type: 'winner', group: 'A' },
    { type: 'thirdColumn', column: '1A', candidates: THIRD_PLACE_CANDIDATES['1A'] }
  ],
  '760495': [
    { type: 'winner', group: 'L' },
    { type: 'thirdColumn', column: '1L', candidates: THIRD_PLACE_CANDIDATES['1L'] }
  ],
  '760493': [
    { type: 'winner', group: 'G' },
    { type: 'thirdColumn', column: '1G', candidates: THIRD_PLACE_CANDIDATES['1G'] }
  ],
  '760494': [
    { type: 'winner', group: 'D' },
    { type: 'thirdColumn', column: '1D', candidates: THIRD_PLACE_CANDIDATES['1D'] }
  ],
  '760497': [
    { type: 'winner', group: 'H' },
    { type: 'runnerUp', group: 'J' }
  ],
  '760496': [
    { type: 'runnerUp', group: 'K' },
    { type: 'runnerUp', group: 'L' }
  ],
  '760498': [
    { type: 'winner', group: 'B' },
    { type: 'thirdColumn', column: '1B', candidates: THIRD_PLACE_CANDIDATES['1B'] }
  ],
  '760499': [
    { type: 'runnerUp', group: 'D' },
    { type: 'runnerUp', group: 'G' }
  ],
  '760500': [
    { type: 'winner', group: 'J' },
    { type: 'runnerUp', group: 'H' }
  ],
  '760501': [
    { type: 'winner', group: 'K' },
    { type: 'thirdColumn', column: '1K', candidates: THIRD_PLACE_CANDIDATES['1K'] }
  ],
  '760502': [
    { type: 'winnerOf', matchId: '760486' },
    { type: 'winnerOf', matchId: '760488' }
  ],
  '760503': [
    { type: 'winnerOf', matchId: '760489' },
    { type: 'winnerOf', matchId: '760492' }
  ],
  '760504': [
    { type: 'winnerOf', matchId: '760487' },
    { type: 'winnerOf', matchId: '760490' }
  ],
  '760505': [
    { type: 'winnerOf', matchId: '760491' },
    { type: 'winnerOf', matchId: '760495' }
  ],
  '760506': [
    { type: 'winnerOf', matchId: '760496' },
    { type: 'winnerOf', matchId: '760497' }
  ],
  '760507': [
    { type: 'winnerOf', matchId: '760494' },
    { type: 'winnerOf', matchId: '760493' }
  ],
  '760509': [
    { type: 'winnerOf', matchId: '760500' },
    { type: 'winnerOf', matchId: '760499' }
  ],
  '760508': [
    { type: 'winnerOf', matchId: '760498' },
    { type: 'winnerOf', matchId: '760501' }
  ],
  '760510': [
    { type: 'winnerOf', matchId: '760502' },
    { type: 'winnerOf', matchId: '760503' }
  ],
  '760511': [
    { type: 'winnerOf', matchId: '760506' },
    { type: 'winnerOf', matchId: '760507' }
  ],
  '760512': [
    { type: 'winnerOf', matchId: '760504' },
    { type: 'winnerOf', matchId: '760505' }
  ],
  '760513': [
    { type: 'winnerOf', matchId: '760509' },
    { type: 'winnerOf', matchId: '760508' }
  ],
  '760514': [
    { type: 'winnerOf', matchId: '760510' },
    { type: 'winnerOf', matchId: '760511' }
  ],
  '760515': [
    { type: 'winnerOf', matchId: '760512' },
    { type: 'winnerOf', matchId: '760513' }
  ],
  '760516': [
    { type: 'loserOf', matchId: '760514' },
    { type: 'loserOf', matchId: '760515' }
  ],
  '760517': [
    { type: 'winnerOf', matchId: '760514' },
    { type: 'winnerOf', matchId: '760515' }
  ]
};

export const KNOCKOUT_GAME_LABELS: Record<MatchId, string> = {
  '760486': 'Round of 32 | Game 1',
  '760489': 'Round of 32 | Game 2',
  '760488': 'Round of 32 | Game 3',
  '760487': 'Round of 32 | Game 4',
  '760492': 'Round of 32 | Game 5',
  '760490': 'Round of 32 | Game 6',
  '760491': 'Round of 32 | Game 7',
  '760495': 'Round of 32 | Game 8',
  '760494': 'Round of 32 | Game 9',
  '760493': 'Round of 32 | Game 10',
  '760496': 'Round of 32 | Game 11',
  '760497': 'Round of 32 | Game 12',
  '760498': 'Round of 32 | Game 13',
  '760500': 'Round of 32 | Game 14',
  '760501': 'Round of 32 | Game 15',
  '760499': 'Round of 32 | Game 16',
  '760502': 'Round of 16 | Game 1',
  '760503': 'Round of 16 | Game 2',
  '760504': 'Round of 16 | Game 3',
  '760505': 'Round of 16 | Game 4',
  '760506': 'Round of 16 | Game 5',
  '760507': 'Round of 16 | Game 6',
  '760509': 'Round of 16 | Game 7',
  '760508': 'Round of 16 | Game 8',
  '760510': 'Quarterfinals | Game 1',
  '760511': 'Quarterfinals | Game 2',
  '760512': 'Quarterfinals | Game 3',
  '760513': 'Quarterfinals | Game 4',
  '760514': 'Semifinals | Game 1',
  '760515': 'Semifinals | Game 2',
  '760516': 'Third Place | Game 1',
  '760517': 'Final | Game 1'
};
