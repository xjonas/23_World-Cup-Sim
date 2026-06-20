import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { BRACKET_SOURCES, GROUPS, KNOCKOUT_GAME_LABELS, PHASE_LABELS, PHASE_ORDER } from './data/constants';
import { SNAPSHOT } from './data/snapshot';
import { fetchTournamentData } from './lib/espn';
import { formatDateTime, formatPacificTime, formatShortDate, phaseLabel, teamName } from './lib/format';
import { buildBracket, getThirdPlaceAssignment } from './lib/bracket';
import { buildBracketLayout } from './lib/bracketLayout';
import { fetchPolymarketOddsForMatches } from './lib/polymarket';
import { buildLeaderboard, isPredictionLocked, predictionToScore, scorePrediction } from './lib/predictions';
import { clearSimulatedGroupStageScores, simulateGroupStage } from './lib/simulation';
import { buildGroupRankings, buildThirdPlaceRanking, getEffectiveScore } from './lib/standings';
import { loadSimulationState, saveSimulationState } from './lib/storage';
import { supabase, type SupabaseUser } from './lib/supabase';
import type {
  BracketMatch,
  BracketSlot,
  GroupLetter,
  GroupRanking,
  GroupStanding,
  LeaderboardRow,
  Match,
  MatchOdds,
  MatchPrediction,
  Profile,
  Score,
  SimulationState,
  Team,
  TeamId,
  ThirdPlaceRanking,
  TournamentData
} from './types';

type Tab = 'auth' | 'overview' | 'groups' | 'matches' | 'bracket';
type DataMode = 'snapshot' | 'live' | 'loading' | 'error';
type ResultState = 'winner' | 'loser' | 'draw' | '';
type NoticeTone = 'success' | 'error' | 'info';

const SNAPSHOT_DATA = SNAPSHOT as unknown as TournamentData;
const FIFA_26_LOGO_URL =
  'https://upload.wikimedia.org/wikipedia/en/thumb/1/17/2026_FIFA_World_Cup_emblem.svg/250px-2026_FIFA_World_Cup_emblem.svg.png';
const SIMULATION_EXPLANATION =
  'Completed ESPN results and manually typed scores are kept. Remaining group matches use market win/draw/win probabilities plus over/under total-goals odds. Close matchups are softened for uncertainty, then the app samples a plausible soccer scoreline instead of always picking the favorite.';

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<TournamentData>(SNAPSHOT_DATA);
  const [dataMode, setDataMode] = useState<DataMode>('snapshot');
  const [dataError, setDataError] = useState<string | null>(null);
  const [state, setState] = useState<SimulationState>(() => loadSimulationState());
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [predictions, setPredictions] = useState<MatchPrediction[]>([]);
  const [predictorBusy, setPredictorBusy] = useState(false);
  const [predictorMessage, setPredictorMessage] = useState<string | null>(null);
  const [topNotice, setTopNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);
  const [now, setNow] = useState(() => new Date());

  const showTopNotice = useCallback((text: string, tone: NoticeTone = 'info') => {
    setTopNotice({ text, tone });
  }, []);

  useEffect(() => {
    if (!topNotice) {
      return;
    }
    const timeout = window.setTimeout(() => setTopNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [topNotice]);

  useEffect(() => {
    saveSimulationState(state);
  }, [state]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data: authData }) => {
      if (!cancelled) {
        setUser(authData.session?.user ?? null);
        setAuthReady(true);
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const refreshData = useCallback(async () => {
    setDataMode('loading');
    setDataError(null);
    try {
      const live = await fetchTournamentData();
      setData(live);
      setState((current) => ({ ...current, lastSyncedAt: live.fetchedAt }));
      setDataMode('live');
    } catch (error) {
      setData(SNAPSHOT_DATA);
      setDataMode('error');
      setDataError(error instanceof Error ? error.message : 'Could not load live data');
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const teamsById = useMemo(() => new Map(data.teams.map((team) => [team.id, team])), [data.teams]);
  const groupRankings = useMemo(() => buildGroupRankings(data.matches, state), [data.matches, state]);
  const thirdPlaceRanking = useMemo(
    () => buildThirdPlaceRanking(groupRankings, state.manualThirdPlaceOrder),
    [groupRankings, state.manualThirdPlaceOrder]
  );
  const bracket = useMemo(
    () => buildBracket(data.matches, teamsById, groupRankings, thirdPlaceRanking, state),
    [data.matches, teamsById, groupRankings, thirdPlaceRanking, state]
  );
  const ownPredictionsByMatch = useMemo(() => {
    const own = predictions.filter((prediction) => prediction.userId === user?.id);
    return new Map(own.map((prediction) => [prediction.matchId, prediction]));
  }, [predictions, user?.id]);
  const leaderboard = useMemo(() => buildLeaderboard(profiles, predictions, data.matches), [profiles, predictions, data.matches]);
  const ownSimulationPredictionCount = useMemo(
    () => predictions.filter((prediction) => prediction.userId === user?.id && prediction.source === 'simulation').length,
    [predictions, user?.id]
  );

  useEffect(() => {
    if (authReady && !user && tab === 'overview') {
      setTab('matches');
    }
  }, [authReady, tab, user]);

  const loadPredictorData = useCallback(async () => {
    if (!supabase || !user) {
      setProfile(null);
      setProfiles([]);
      setPredictions([]);
      return;
    }

    setPredictorBusy(true);
    const [profilesResult, predictionsResult] = await Promise.all([
      supabase.from('profiles').select('*').order('display_name', { ascending: true }),
      supabase.from('match_predictions').select('*')
    ]);

    if (profilesResult.error || predictionsResult.error) {
      setPredictorMessage(profilesResult.error?.message ?? predictionsResult.error?.message ?? 'Could not load predictor data.');
      setPredictorBusy(false);
      return;
    }

    const nextProfiles = (profilesResult.data ?? []).map(mapProfileRow);
    const nextPredictions = (predictionsResult.data ?? []).map(mapPredictionRow);
    setProfiles(nextProfiles);
    setPredictions(nextPredictions);
    setProfile(nextProfiles.find((candidate) => candidate.userId === user.id) ?? null);
    setPredictorBusy(false);
  }, [user]);

  useEffect(() => {
    loadPredictorData();
  }, [loadPredictorData]);

  const saveProfile = useCallback(
    async (displayName: string, targetUser = user, options: { announce?: boolean } = {}) => {
      const normalizedName = displayName.trim();
      if (!supabase || !targetUser || !normalizedName) {
        return false;
      }

      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: targetUser.id,
          display_name: normalizedName
        },
        { onConflict: 'user_id' }
      );

      if (error) {
        setPredictorMessage(error.message);
        return false;
      }

      const nextProfile = { userId: targetUser.id, displayName: normalizedName };
      setProfile(nextProfile);
      setProfiles((current) => [nextProfile, ...current.filter((candidate) => candidate.userId !== targetUser.id)]);
      setPredictorMessage(null);
      if (options.announce) {
        showTopNotice(`Profile saved for ${normalizedName}.`, 'success');
      }
      return true;
    },
    [showTopNotice, user]
  );

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return;
    }
    setPredictorBusy(true);
    setPredictorMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPredictorBusy(false);
    if (error) {
      setPredictorMessage(error.message);
      return;
    }
    setPredictorMessage(null);
    setTab('overview');
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      if (!supabase) {
        return;
      }
      setPredictorBusy(true);
      setPredictorMessage(null);
      const { data: authData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName.trim()
          }
        }
      });
      setPredictorBusy(false);
      if (error) {
        setPredictorMessage(error.message);
        return;
      }
      const normalizedName = displayName.trim();
      let profileSaved = true;
      if (authData.user && authData.session) {
        profileSaved = await saveProfile(normalizedName, authData.user, { announce: false });
      }
      if (!profileSaved) {
        return;
      }
      setPredictorMessage(null);
      showTopNotice(
        authData.session
          ? `Account created for ${normalizedName}.`
          : `Account created for ${normalizedName}. Check your email if confirmation is enabled.`,
        'success'
      );
      if (authData.session) {
        setTab('overview');
      }
    },
    [saveProfile, showTopNotice]
  );

  const signOut = useCallback(async () => {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
    setProfile(null);
    setProfiles([]);
    setPredictions([]);
    setPredictorMessage(null);
    if (tab === 'overview') {
      setTab('matches');
    }
  }, [tab]);

  const savePrediction = useCallback(
    async (match: Match, score: Score) => {
      if (!supabase || !user) {
        showTopNotice('Sign in to save predictions.', 'error');
        return;
      }
      if (isPredictionLocked(match, now)) {
        showTopNotice('Prediction locked.', 'error');
        return;
      }

      const { error } = await supabase.from('match_predictions').upsert(
        {
          user_id: user.id,
          match_id: match.id,
          home_goals: score.home,
          away_goals: score.away,
          source: 'manual'
        },
        { onConflict: 'user_id,match_id' }
      );

      if (error) {
        showTopNotice(formatPredictionError(error.message), 'error');
        return;
      }

      const saved = { userId: user.id, matchId: match.id, homeGoals: score.home, awayGoals: score.away, source: 'manual' as const };
      setPredictions((current) => [
        ...current.filter((prediction) => !(prediction.userId === user.id && prediction.matchId === match.id)),
        saved
      ]);
      showTopNotice('Prediction saved.', 'success');
    },
    [now, showTopNotice, user]
  );

  const clearPrediction = useCallback(
    async (match: Match) => {
      if (!supabase || !user) {
        showTopNotice('Sign in to clear predictions.', 'error');
        return;
      }
      if (isPredictionLocked(match, now)) {
        showTopNotice('Prediction locked.', 'error');
        return;
      }

      const { error } = await supabase
        .from('match_predictions')
        .delete()
        .eq('user_id', user.id)
        .eq('match_id', match.id);

      if (error) {
        showTopNotice(formatPredictionError(error.message), 'error');
        return;
      }

      setPredictions((current) =>
        current.filter((prediction) => !(prediction.userId === user.id && prediction.matchId === match.id))
      );
      showTopNotice('Prediction cleared.', 'success');
    },
    [now, showTopNotice, user]
  );

  const setScoreOverride = useCallback((matchId: string, score: Score) => {
    setState((current) => {
      const simulationOdds = { ...current.simulationOdds };
      const manualKnockoutWinners = { ...current.manualKnockoutWinners };
      delete simulationOdds[matchId];
      delete manualKnockoutWinners[matchId];
      return {
        ...current,
        scoreOverrides: { ...current.scoreOverrides, [matchId]: score },
        scoreSources: { ...current.scoreSources, [matchId]: 'manual' },
        simulationOdds,
        manualKnockoutWinners
      };
    });
  }, []);

  const clearScoreOverride = useCallback((matchId: string) => {
    setState((current) => {
      const next = { ...current.scoreOverrides };
      const nextSources = { ...current.scoreSources };
      const nextSimulationOdds = { ...current.simulationOdds };
      const nextManualKnockoutWinners = { ...current.manualKnockoutWinners };
      delete next[matchId];
      delete nextSources[matchId];
      delete nextSimulationOdds[matchId];
      delete nextManualKnockoutWinners[matchId];
      return {
        ...current,
        scoreOverrides: next,
        scoreSources: nextSources,
        simulationOdds: nextSimulationOdds,
        manualKnockoutWinners: nextManualKnockoutWinners
      };
    });
  }, []);

  const setManualWinner = useCallback((matchId: string, winnerTeamId: string) => {
    setState((current) => ({
      ...current,
      manualKnockoutWinners: winnerTeamId
        ? { ...current.manualKnockoutWinners, [matchId]: winnerTeamId }
        : Object.fromEntries(Object.entries(current.manualKnockoutWinners).filter(([id]) => id !== matchId))
    }));
  }, []);

  const moveGroupTeam = useCallback((group: GroupLetter, teamId: TeamId, direction: -1 | 1) => {
    setState((current) => {
      const currentOrder = groupRankings[group].standings.map((standing) => standing.teamId);
      const manualOrder = current.manualGroupOrders[group] ?? currentOrder;
      const ordered = mergeOrder(currentOrder, manualOrder);
      const index = ordered.indexOf(teamId);
      const swap = index + direction;
      if (index < 0 || swap < 0 || swap >= ordered.length) {
        return current;
      }
      [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
      return {
        ...current,
        manualGroupOrders: {
          ...current.manualGroupOrders,
          [group]: ordered
        }
      };
    });
  }, [groupRankings]);

  const moveThirdPlaceGroup = useCallback((group: GroupLetter, direction: -1 | 1) => {
    setState((current) => {
      const currentOrder = thirdPlaceRanking.entries.map((entry) => entry.group);
      const manualOrder = current.manualThirdPlaceOrder.length ? current.manualThirdPlaceOrder : currentOrder;
      const ordered = mergeOrder(currentOrder, manualOrder);
      const index = ordered.indexOf(group);
      const swap = index + direction;
      if (index < 0 || swap < 0 || swap >= ordered.length) {
        return current;
      }
      [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
      return { ...current, manualThirdPlaceOrder: ordered };
    });
  }, [thirdPlaceRanking.entries]);

  const runGroupSimulation = useCallback(async () => {
    setSimulationBusy(true);
    setSimulationMessage(null);
    let externalOdds: Record<string, MatchOdds> = {};
    let marketNote = '';
    try {
      externalOdds = await fetchPolymarketOddsForMatches(data.matches, teamsById);
      const marketCount = Object.keys(externalOdds).length;
      marketNote = marketCount ? ` Polymarket supplemented ${marketCount} match${marketCount === 1 ? '' : 'es'}.` : '';
    } catch (error) {
      marketNote = ` Polymarket unavailable; used ESPN odds and fallback model.`;
    }

    const result = simulateGroupStage(data.matches, teamsById, state, { externalOdds });
    let filledPredictionCount = 0;
    let preservedPredictionCount = 0;

    if (supabase && user) {
      const existingPredictionIds = new Set(
        predictions.filter((prediction) => prediction.userId === user.id).map((prediction) => prediction.matchId)
      );
      const simulatedRows = data.matches
        .map((match) => {
          const simulatedScore = result.state.scoreOverrides[match.id];
          const isSimulatedPredictionCandidate =
            match.phase === 'group-stage' &&
            result.state.scoreSources[match.id] === 'simulation' &&
            simulatedScore &&
            !isPredictionLocked(match, now);

          if (isSimulatedPredictionCandidate && existingPredictionIds.has(match.id)) {
            preservedPredictionCount += 1;
            return null;
          }

          if (
            match.phase !== 'group-stage' ||
            result.state.scoreSources[match.id] !== 'simulation' ||
            !simulatedScore ||
            isPredictionLocked(match, now)
          ) {
            return null;
          }
          return {
            user_id: user.id,
            match_id: match.id,
            home_goals: simulatedScore.home,
            away_goals: simulatedScore.away,
            source: 'simulation'
          };
        })
        .filter(
          (row): row is { user_id: string; match_id: string; home_goals: number; away_goals: number; source: 'simulation' } =>
            Boolean(row)
        );

      if (simulatedRows.length) {
        const { error } = await supabase.from('match_predictions').upsert(simulatedRows, { onConflict: 'user_id,match_id' });
        if (error) {
          showTopNotice(formatPredictionError(error.message), 'error');
        } else {
          filledPredictionCount = simulatedRows.length;
          const savedPredictions = simulatedRows.map((row) => ({
            userId: row.user_id,
            matchId: row.match_id,
            homeGoals: row.home_goals,
            awayGoals: row.away_goals,
            source: 'simulation' as const
          }));
          const savedMatchIds = new Set(savedPredictions.map((prediction) => prediction.matchId));
          setPredictions((current) => [
            ...current.filter((prediction) => prediction.userId !== user.id || !savedMatchIds.has(prediction.matchId)),
            ...savedPredictions
          ]);
          showTopNotice(
            `Filled ${filledPredictionCount} empty prediction${filledPredictionCount === 1 ? '' : 's'} from simulation.`,
            'success'
          );
        }
      }
    }

    setState(result.state);
    setSimulationMessage(
      `Simulated ${result.simulatedCount} group match${result.simulatedCount === 1 ? '' : 'es'}: ${
        result.oddsBackedCount
      } odds-backed, ${result.fallbackCount} fallback. Preserved ${result.skippedManualCount} manual score${
        result.skippedManualCount === 1 ? '' : 's'
      }.${
        filledPredictionCount
          ? ` Filled ${filledPredictionCount} empty prediction${filledPredictionCount === 1 ? '' : 's'}.`
          : ''
      }${
        preservedPredictionCount
          ? ` Preserved ${preservedPredictionCount} existing tip${preservedPredictionCount === 1 ? '' : 's'}.`
          : ''
      }${marketNote}`
    );
    setSimulationBusy(false);
  }, [data.matches, now, predictions, showTopNotice, state, teamsById, user]);

  const clearSimulatedScores = useCallback(async () => {
    setState((current) => clearSimulatedGroupStageScores(data.matches, current));
    let clearedPredictionCount = 0;

    if (supabase && user) {
      const { error } = await supabase
        .from('match_predictions')
        .delete()
        .eq('user_id', user.id)
        .eq('source', 'simulation');

      if (error) {
        showTopNotice(formatPredictionError(error.message), 'error');
      } else {
        const unlockedMatchIds = new Set(data.matches.filter((match) => !isPredictionLocked(match, now)).map((match) => match.id));
        clearedPredictionCount = predictions.filter(
          (prediction) =>
            prediction.userId === user.id &&
            prediction.source === 'simulation' &&
            unlockedMatchIds.has(prediction.matchId)
        ).length;
        setPredictions((current) =>
          current.filter(
            (prediction) =>
              prediction.userId !== user.id ||
              prediction.source !== 'simulation' ||
              !unlockedMatchIds.has(prediction.matchId)
          )
        );
      }
    }

    setSimulationMessage(
      `Cleared simulated group-stage results${
        clearedPredictionCount ? ` and ${clearedPredictionCount} simulated prediction${clearedPredictionCount === 1 ? '' : 's'}` : ''
      }.`
    );
  }, [data.matches, now, predictions, showTopNotice, user]);

  const sourceText =
    dataMode === 'live'
      ? 'Live ESPN data'
      : dataMode === 'loading'
        ? 'Refreshing ESPN data'
        : dataMode === 'error'
          ? 'Bundled snapshot fallback'
          : 'Bundled snapshot';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-logo-frame">
            <img src={FIFA_26_LOGO_URL} alt="FIFA World Cup 26 emblem" />
          </div>
          <div>
            <p className="eyebrow">FIFA World Cup 26</p>
            <h1>Tournament</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="topbar-command-stack">
            <AuthPanel
              user={user}
              profile={profile}
              authReady={authReady}
              predictorAvailable={Boolean(supabase)}
              busy={predictorBusy}
              onSignOut={signOut}
              onOpenAuth={() => setTab('auth')}
            />
            <div className="topbar-control-row">
              <div className="sync-status">
                <strong>{sourceText}</strong>
                <span>{formatDateTime(data.fetchedAt)}</span>
                {dataError ? <span className="warning-text">{dataError}</span> : null}
              </div>
              <div className="topbar-button-row">
                <button className="secondary-button" onClick={refreshData} disabled={dataMode === 'loading'}>
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {topNotice ? <div className={`top-notice ${topNotice.tone}`}>{topNotice.text}</div> : null}

      <nav className="tabs" aria-label="Tournament views">
        {user ? (
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
            Overview
          </TabButton>
        ) : null}
        <TabButton active={tab === 'matches'} onClick={() => setTab('matches')}>
          Matches
        </TabButton>
        <TabButton active={tab === 'groups'} onClick={() => setTab('groups')}>
          Groups
        </TabButton>
        <TabButton active={tab === 'bracket'} onClick={() => setTab('bracket')}>
          Knockout
        </TabButton>
      </nav>

      {tab === 'auth' ? (
        <AuthView
          user={user}
          profile={profile}
          predictorAvailable={Boolean(supabase)}
          busy={predictorBusy}
          message={predictorMessage}
          onSignIn={signIn}
          onSignUp={signUp}
        />
      ) : null}
      {user && tab === 'overview' ? (
        <OverviewView
          leaderboard={leaderboard}
          predictorAvailable={Boolean(supabase)}
          user={user}
          profiles={profiles}
          predictions={predictions}
          busy={predictorBusy}
        />
      ) : null}
      {tab === 'groups' ? (
        <GroupsView
          matches={data.matches}
          teamsById={teamsById}
          rankings={groupRankings}
          thirdPlaceRanking={thirdPlaceRanking}
          onMoveGroupTeam={moveGroupTeam}
          onMoveThirdPlaceGroup={moveThirdPlaceGroup}
        />
      ) : null}
      {tab === 'matches' ? (
        <MatchesView
          matches={data.matches}
          teamsById={teamsById}
          state={state}
          onScore={setScoreOverride}
          onClearScore={clearScoreOverride}
          onSimulateGroupStage={runGroupSimulation}
          onClearSimulatedScores={clearSimulatedScores}
          simulationBusy={simulationBusy}
          simulationMessage={simulationMessage}
          simulationPredictionCount={ownSimulationPredictionCount}
          bracket={bracket}
          currentUserId={user?.id ?? null}
          predictorAvailable={Boolean(supabase)}
          ownPredictionsByMatch={ownPredictionsByMatch}
          now={now}
          onPrediction={savePrediction}
          onClearPrediction={clearPrediction}
        />
      ) : null}

      {tab === 'bracket' ? (
        <BracketView
          bracket={bracket}
          state={state}
          thirdPlaceRanking={thirdPlaceRanking}
          onScore={setScoreOverride}
          onClearScore={clearScoreOverride}
        />
      ) : null}
    </main>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button className={active ? 'tab active' : 'tab'} onClick={onClick}>
      {children}
    </button>
  );
}

function AuthPanel({
  user,
  profile,
  authReady,
  predictorAvailable,
  busy,
  onSignOut,
  onOpenAuth
}: {
  user: SupabaseUser | null;
  profile: Profile | null;
  authReady: boolean;
  predictorAvailable: boolean;
  busy: boolean;
  onSignOut: () => Promise<void>;
  onOpenAuth: () => void;
}) {
  if (!predictorAvailable) {
    return (
      <section className="auth-panel" aria-label="Predictor account">
        <strong>Predictor offline</strong>
        <span>Add Supabase env vars.</span>
      </section>
    );
  }

  if (!authReady) {
    return (
      <section className="auth-panel" aria-label="Predictor account">
        <strong>Loading account...</strong>
      </section>
    );
  }

  if (user) {
    return (
      <section className="auth-panel auth-entry-panel signed-in" aria-label="Predictor account">
        <strong className="auth-display-name">{profile?.displayName ?? getUserDisplayName(user)}</strong>
        <button className="primary-button auth-entry-button" onClick={onSignOut} disabled={busy}>
          Sign out
        </button>
      </section>
    );
  }

  return (
    <section className="auth-panel auth-entry-panel" aria-label="Predictor account">
      <button className="primary-button auth-entry-button" onClick={onOpenAuth} disabled={busy}>
        Sign in / Sign up
      </button>
    </section>
  );
}

function AuthView({
  user,
  profile,
  predictorAvailable,
  busy,
  message,
  onSignIn,
  onSignUp
}: {
  user: SupabaseUser | null;
  profile: Profile | null;
  predictorAvailable: boolean;
  busy: boolean;
  message: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    if (mode === 'sign-up') {
      await onSignUp(email.trim(), password, displayName);
    } else {
      await onSignIn(email.trim(), password);
    }
  }

  if (!predictorAvailable) {
    return (
      <section className="auth-page">
        <section className="panel auth-card">
          <h2>Predictor unavailable</h2>
          <p>Supabase is not configured for this environment.</p>
        </section>
      </section>
    );
  }

  if (user) {
    return (
      <section className="auth-page">
        <section className="panel auth-card">
          <h2>Signed in</h2>
          <p>{profile?.displayName ?? getUserDisplayName(user)}</p>
        </section>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <section className="panel auth-card">
        <div className="panel-title">
          <h2>{mode === 'sign-up' ? 'Create account' : 'Sign in'}</h2>
          <div className="auth-mode-toggle page-toggle">
            <button className={mode === 'sign-in' ? 'active' : ''} onClick={() => setMode('sign-in')} type="button">
              Sign in
            </button>
            <button className={mode === 'sign-up' ? 'active' : ''} onClick={() => setMode('sign-up')} type="button">
              Sign up
            </button>
          </div>
        </div>
        <form className="auth-form auth-page-form" onSubmit={submitAuth}>
          {mode === 'sign-up' ? (
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </label>
          ) : null}
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary-button" disabled={busy}>
            {mode === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        {message ? <p className="auth-page-message">{message}</p> : null}
      </section>
    </section>
  );
}

function OverviewView({
  leaderboard,
  predictorAvailable,
  user,
  profiles,
  predictions,
  busy
}: {
  leaderboard: LeaderboardRow[];
  predictorAvailable: boolean;
  user: SupabaseUser | null;
  profiles: Profile[];
  predictions: MatchPrediction[];
  busy: boolean;
}) {
  return (
    <section className="view-stack">
      <section className="panel overview-summary">
        <div>
          <h2>Overview</h2>
          <p>
            {predictorAvailable
              ? `${profiles.length} player${profiles.length === 1 ? '' : 's'} · ${predictions.length} visible prediction${
                  predictions.length === 1 ? '' : 's'
                }`
              : 'Supabase is not configured.'}
          </p>
        </div>
      </section>

      <details className="panel rules-panel">
        <summary>Scoring rules</summary>
        <div className="rules-content">
          <p>Predictions lock at kickoff. Completed ESPN results decide the points.</p>
          <ul>
            <li>Exact score: 4 points.</li>
            <li>Correct goal difference for a win: 3 points.</li>
            <li>Correct winner or draw tendency: 2 points.</li>
          </ul>
          <p>Example: if the result is 2-1, a 2-1 pick gets 4, 3-2 or 1-0 gets 3, and 2-0 gets 2.</p>
        </div>
      </details>

      <section className="panel">
        <div className="panel-title">
          <h2>Leaderboard</h2>
          {busy ? <span className="status-pill">Syncing</span> : null}
        </div>
        <div className="table-wrap">
          <table className="standings-table leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Total</th>
                <th>Exact</th>
                <th>GD</th>
                <th>Tendency</th>
                <th>Picks</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr key={row.userId} className={row.userId === user?.id ? 'current-player-row' : ''}>
                  <td>{row.rank}</td>
                  <td>{row.displayName}</td>
                  <td>{row.totalPoints}</td>
                  <td>{row.exactScores}</td>
                  <td>{row.goalDifferences}</td>
                  <td>{row.tendencies}</td>
                  <td>{row.submittedPicks}</td>
                </tr>
              ))}
              {!leaderboard.length ? (
                <tr>
                  <td colSpan={7}>No players yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function GroupsView({
  matches,
  teamsById,
  rankings,
  thirdPlaceRanking,
  onMoveGroupTeam,
  onMoveThirdPlaceGroup
}: {
  matches: Match[];
  teamsById: Map<string, Team>;
  rankings: Record<GroupLetter, GroupRanking>;
  thirdPlaceRanking: ThirdPlaceRanking;
  onMoveGroupTeam: (group: GroupLetter, teamId: TeamId, direction: -1 | 1) => void;
  onMoveThirdPlaceGroup: (group: GroupLetter, direction: -1 | 1) => void;
}) {
  return (
    <section className="view-stack">
      <section className="groups-grid">
        {GROUPS.map((group) => (
            <GroupCard
            key={group}
            group={group}
            ranking={rankings[group]}
            matches={matches.filter((match) => match.group === group)}
            teamsById={teamsById}
            onMoveTeam={onMoveGroupTeam}
          />
        ))}
      </section>
      <ThirdPlaceTable ranking={thirdPlaceRanking} teamsById={teamsById} onMoveGroup={onMoveThirdPlaceGroup} />
    </section>
  );
}

function GroupCard({
  group,
  ranking,
  matches,
  teamsById,
  onMoveTeam
}: {
  group: GroupLetter;
  ranking: GroupRanking;
  matches: Match[];
  teamsById: Map<string, Team>;
  onMoveTeam: (group: GroupLetter, teamId: TeamId, direction: -1 | 1) => void;
}) {
  return (
    <article className="panel group-panel">
      <div className="panel-title">
        <h2>Group {group}</h2>
        {ranking.unresolvedTies.length ? <span className="status-pill warn">Tie needs decision</span> : null}
      </div>
      {ranking.unresolvedTies.length ? <TieDecisionNote /> : null}
      <StandingsTable standings={ranking.standings} teamsById={teamsById} group={group} onMoveTeam={onMoveTeam} />
      <div className="mini-match-list">
        {matches.map((match) => (
          <div key={match.id} className="mini-match">
            <span>
              {formatShortDate(match.kickoffUtc)} · {formatPacificTime(match.kickoffUtc)}
            </span>
            <strong>
              {teamName(teamsById, match.homeTeamId)} vs {teamName(teamsById, match.awayTeamId)}
            </strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function StandingsTable({
  standings,
  teamsById,
  group,
  onMoveTeam
}: {
  standings: GroupStanding[];
  teamsById: Map<string, Team>;
  group: GroupLetter;
  onMoveTeam: (group: GroupLetter, teamId: TeamId, direction: -1 | 1) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="standings-table">
        <thead>
          <tr>
            <th>Team</th>
            <th>Pts</th>
            <th>GD</th>
            <th>GF</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing, index) => (
            <tr key={standing.teamId} className={index < 2 ? 'advance-row' : index === 2 ? 'third-row' : ''}>
              <td>
                <TeamLabel team={teamsById.get(standing.teamId)} />
                {standing.tieStatus !== 'clear' ? <span className="tiny-warning">manual</span> : null}
              </td>
              <td>{standing.points}</td>
              <td>{formatSigned(standing.goalDifference)}</td>
              <td>{standing.goalsFor}</td>
              <td>{standing.wins}</td>
              <td>{standing.draws}</td>
              <td>{standing.losses}</td>
              <td className="order-buttons">
                {standing.tieStatus !== 'clear' ? (
                  <>
                    <button aria-label="Move up" onClick={() => onMoveTeam(group, standing.teamId, -1)}>
                      ↑
                    </button>
                    <button aria-label="Move down" onClick={() => onMoveTeam(group, standing.teamId, 1)}>
                      ↓
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThirdPlaceTable({
  ranking,
  teamsById,
  onMoveGroup
}: {
  ranking: ThirdPlaceRanking;
  teamsById: Map<string, Team>;
  onMoveGroup: (group: GroupLetter, direction: -1 | 1) => void;
}) {
  const assignment = getThirdPlaceAssignment(ranking.qualifiedGroups);

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Best Third-Place Teams</h2>
        {ranking.unresolvedTies.length ? <span className="status-pill warn">Tie needs decision</span> : null}
      </div>
      {ranking.unresolvedTies.length ? <TieDecisionNote /> : null}
      <div className="table-wrap">
        <table className="standings-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Group</th>
              <th>Team</th>
              <th>Pts</th>
              <th>GD</th>
              <th>GF</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ranking.entries.map((entry, index) => (
              <tr key={entry.group} className={index < 8 ? 'advance-row' : ''}>
                <td>{index + 1}</td>
                <td>{entry.group}</td>
                <td>
                  <TeamLabel team={teamsById.get(entry.teamId)} />
                  {entry.tieStatus !== 'clear' ? <span className="tiny-warning">manual</span> : null}
                </td>
                <td>{entry.points}</td>
                <td>{formatSigned(entry.goalDifference)}</td>
                <td>{entry.goalsFor}</td>
                <td className="order-buttons">
                  {entry.tieStatus !== 'clear' ? (
                    <>
                      <button aria-label="Move up" onClick={() => onMoveGroup(entry.group, -1)}>
                        ↑
                      </button>
                      <button aria-label="Move down" onClick={() => onMoveGroup(entry.group, 1)}>
                        ↓
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="assignment-note">
        {assignment
          ? `Third-place bracket groups: 1A-${assignment['1A']}, 1B-${assignment['1B']}, 1D-${assignment['1D']}, 1E-${assignment['1E']}, 1G-${assignment['1G']}, 1I-${assignment['1I']}, 1K-${assignment['1K']}, 1L-${assignment['1L']}.`
          : 'Third-place bracket slots will resolve once eight third-place qualifiers are available.'}
      </p>
    </section>
  );
}

function TieDecisionNote() {
  return (
    <p className="tie-note">
      Manual order needed. FIFA fair-play scoring would use yellow -1, second-yellow red -3, direct red -4, yellow plus
      direct red -5, then FIFA ranking if still tied; this ESPN feed does not expose reliable card totals here.
    </p>
  );
}

function InfoTip({ text, variant = 'info' }: { text: string; variant?: 'info' | 'eye' }) {
  return (
    <span className={variant === 'eye' ? 'info-tip eye-tip' : 'info-tip'} tabIndex={0} aria-label={text}>
      <span className="info-icon" aria-hidden="true">
        {variant === 'eye' ? <span className="eye-icon" /> : 'i'}
      </span>
      <span className="info-popover" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function LiveStatusBadge({ match }: { match: Match }) {
  if (!isLiveMatch(match)) {
    return null;
  }
  const minute = getLiveMinute(match);
  return (
    <span className="live-badge" aria-label={minute ? `Live, ${minute}` : 'Live'}>
      <span className="live-dot" aria-hidden="true" />
      <span>LIVE</span>
      {minute ? <span className="live-minute">{minute}</span> : null}
    </span>
  );
}

function MatchesView({
  matches,
  teamsById,
  state,
  onScore,
  onClearScore,
  onSimulateGroupStage,
  onClearSimulatedScores,
  simulationBusy,
  simulationMessage,
  simulationPredictionCount,
  bracket,
  currentUserId,
  predictorAvailable,
  ownPredictionsByMatch,
  now,
  onPrediction,
  onClearPrediction
}: {
  matches: Match[];
  teamsById: Map<string, Team>;
  state: SimulationState;
  onScore: (matchId: string, score: Score) => void;
  onClearScore: (matchId: string) => void;
  onSimulateGroupStage: () => void;
  onClearSimulatedScores: () => void;
  simulationBusy: boolean;
  simulationMessage: string | null;
  simulationPredictionCount: number;
  bracket: BracketMatch[];
  currentUserId: string | null;
  predictorAvailable: boolean;
  ownPredictionsByMatch: Map<string, MatchPrediction>;
  now: Date;
  onPrediction: (match: Match, score: Score) => void;
  onClearPrediction: (match: Match) => void;
}) {
  const bracketById = new Map(bracket.map((match) => [match.match.id, match]));
  const simulatedGroupCount = matches.filter(
    (match) => match.phase === 'group-stage' && state.scoreSources[match.id] === 'simulation'
  ).length;

  return (
    <section className="view-stack">
      <section className="panel simulation-panel">
        <div>
          <h2>
            Group Simulation <InfoTip text={SIMULATION_EXPLANATION} variant="eye" />
          </h2>
          {simulationMessage ? <p className="simulation-message">{simulationMessage}</p> : null}
        </div>
        <div className="simulation-actions">
          <button className="primary-button" onClick={onSimulateGroupStage} disabled={simulationBusy}>
            {simulationBusy ? 'Simulating...' : 'Simulate Group Stage'}
          </button>
          <button
            className="secondary-button"
            onClick={onClearSimulatedScores}
            disabled={!simulatedGroupCount && !simulationPredictionCount}
          >
            Clear Simulated Scores
          </button>
        </div>
      </section>
      {PHASE_ORDER.map((phase) => {
        const phaseMatches = matches.filter((match) => match.phase === phase);
        if (!phaseMatches.length) {
          return null;
        }
        return (
          <section key={phase} className="panel">
            <div className="panel-title">
              <h2>{PHASE_LABELS[phase]}</h2>
              <span className="status-pill">{phaseMatches.length} matches</span>
            </div>
            <div className="match-list">
              {phaseMatches.map((match) => {
                const bracketMatch = bracketById.get(match.id);
                return (
                  <MatchEditor
                    key={match.id}
                    match={match}
                    teamsById={teamsById}
                    state={state}
                    onScore={onScore}
                    onClearScore={onClearScore}
                    bracketMatch={bracketMatch}
                    source={state.scoreSources[match.id]}
                    odds={state.simulationOdds[match.id] ?? match.odds}
                    currentUserId={currentUserId}
                    predictorAvailable={predictorAvailable}
                    ownPrediction={ownPredictionsByMatch.get(match.id)}
                    now={now}
                    onPrediction={onPrediction}
                    onClearPrediction={onClearPrediction}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function MatchEditor({
  match,
  teamsById,
  state,
  onScore,
  onClearScore,
  bracketMatch,
  source,
  odds,
  currentUserId,
  predictorAvailable,
  ownPrediction,
  now,
  onPrediction,
  onClearPrediction
}: {
  match: Match;
  teamsById: Map<string, Team>;
  state: SimulationState;
  onScore: (matchId: string, score: Score) => void;
  onClearScore: (matchId: string) => void;
  bracketMatch?: BracketMatch;
  source?: 'manual' | 'simulation';
  odds?: MatchOdds;
  currentUserId: string | null;
  predictorAvailable: boolean;
  ownPrediction?: MatchPrediction;
  now: Date;
  onPrediction: (match: Match, score: Score) => void;
  onClearPrediction: (match: Match) => void;
}) {
  const score = getEffectiveScore(match, state);
  const homeLabel = bracketMatch?.home.label ?? teamName(teamsById, match.homeTeamId);
  const awayLabel = bracketMatch?.away.label ?? teamName(teamsById, match.awayTeamId);
  const homeTeamId = bracketMatch?.home.teamId ?? match.homeTeamId;
  const awayTeamId = bracketMatch?.away.teamId ?? match.awayTeamId;
  const locked = isApiFinal(match);
  const homeTeam = teamsById.get(match.homeTeamId);
  const awayTeam = teamsById.get(match.awayTeamId);
  const matchupKnown = match.phase === 'group-stage' || (!homeTeam?.isPlaceholder && !awayTeam?.isPlaceholder);
  const predictionLocked = isPredictionLocked(match, now);
  const predictionScore = predictionToScore(ownPrediction);
  const canEditPrediction = Boolean(currentUserId && predictorAvailable && matchupKnown && !predictionLocked);
  const editorScore = canEditPrediction ? predictionScore : score;
  const editorLocked = canEditPrediction ? false : locked || Boolean(currentUserId && (predictionLocked || !matchupKnown));
  const resultScore = canEditPrediction ? null : score;
  const predictionSummaryVisible = Boolean(
    currentUserId && (isLiveMatch(match) || isApiFinal(match) || (ownPrediction && predictionLocked))
  );

  return (
    <article className="match-row">
      <div className="match-meta">
        <strong>{formatDateTime(match.kickoffUtc)}</strong>
        <span>{match.group ? `Group ${match.group}` : phaseLabel(match)}</span>
        <span>{match.venue}</span>
        <LiveStatusBadge match={match} />
        <MatchOddsLabel match={match} source={source} odds={odds} homeLabel={homeLabel} awayLabel={awayLabel} />
      </div>
      <div className="match-main">
        <div className="match-teams">
          <span className={resultClassName('team-token home-token', getResultState('home', resultScore, bracketMatch, homeTeamId))}>
            {homeLabel}
          </span>
          <ScoreEditor
            score={editorScore}
            onScore={(next) => (canEditPrediction ? onPrediction(match, next) : onScore(match.id, next))}
            onClear={() => (canEditPrediction ? onClearPrediction(match) : onClearScore(match.id))}
            locked={editorLocked}
            clearLabel={canEditPrediction ? 'Clear prediction' : 'Clear score override'}
          />
          <span className={resultClassName('team-token away-token', getResultState('away', resultScore, bracketMatch, awayTeamId))}>
            {awayLabel}
          </span>
        </div>
        {predictionSummaryVisible ? <PredictionSummary match={match} prediction={ownPrediction} /> : null}
      </div>
    </article>
  );
}

function MatchOddsLabel({
  match,
  source,
  odds,
  homeLabel,
  awayLabel
}: {
  match: Match;
  source?: 'manual' | 'simulation';
  odds?: MatchOdds;
  homeLabel: string;
  awayLabel: string;
}) {
  const moneyline = odds?.moneyline;
  if (!moneyline) {
    return match.phase === 'group-stage' && !match.completed ? <span className="odds-pill muted">No market odds</span> : null;
  }
  const totalGoals = odds?.totalGoals;
  return (
    <div className="odds-stack">
      <span className={source === 'simulation' ? 'odds-pill simulated' : 'odds-pill'}>
        {source === 'simulation' ? 'Simulated from ' : ''}
        {odds?.provider ?? 'Odds'}
      </span>
      <span className="odds-detail">
        {homeLabel} wins {formatPercent(moneyline.homeWin)} · Draw {formatPercent(moneyline.draw)} · {awayLabel} wins{' '}
        {formatPercent(moneyline.awayWin)}
      </span>
      {totalGoals ? <span className="odds-detail">O/U {formatNumber(totalGoals.line)} · {formatTotalGoalsSummary(totalGoals)}</span> : null}
    </div>
  );
}

function BracketView({
  bracket,
  state,
  thirdPlaceRanking,
  onScore,
  onClearScore
}: {
  bracket: BracketMatch[];
  state: SimulationState;
  thirdPlaceRanking: ThirdPlaceRanking;
  onScore: (matchId: string, score: Score) => void;
  onClearScore: (matchId: string) => void;
}) {
  const layout = buildBracketLayout(bracket);
  const visiblePhases = ['round-of-32', 'round-of-16', 'quarterfinals', 'semifinals', 'final'] as const;

  return (
    <section className="view-stack">
      <section className="panel bracket-summary">
        <h2>Knockout</h2>
        <p>
          Qualified third-place groups: {thirdPlaceRanking.qualifiedGroups.length ? thirdPlaceRanking.qualifiedGroups.join(', ') : 'TBD'}
        </p>
      </section>
      <section className="bracket-scroll">
        <div className="bracket-headings">
          {visiblePhases.map((phase) => (
            <h2 key={phase}>{PHASE_LABELS[phase]}</h2>
          ))}
        </div>
        <div className="bracket-tree" style={{ '--bracket-rows': layout.rows } as CSSProperties}>
          {layout.connectors.map((connector) => (
            <div
              key={connector.matchId}
              className="bracket-connector"
              style={
                {
                  gridColumn: connector.column,
                  gridRow: `${connector.rowStart} / span ${connector.rowSpan}`,
                  '--connector-top': `${connector.topPercent}%`,
                  '--connector-middle': `${connector.middlePercent}%`,
                  '--connector-bottom': `${connector.bottomPercent}%`
                } as CSSProperties
              }
            />
          ))}
          {bracket.map((bracketMatch) => {
            const item = layout.items[bracketMatch.match.id];
            if (!item) {
              return null;
            }
            return (
              <BracketMatchCard
                key={bracketMatch.match.id}
                bracketMatch={bracketMatch}
                onScore={onScore}
                onClearScore={onClearScore}
                style={{ gridColumn: item.column, gridRow: `${item.rowStart} / span ${item.rowSpan}` }}
              />
            );
          })}
        </div>
      </section>
    </section>
  );
}

function BracketMatchCard({
  bracketMatch,
  onScore,
  onClearScore,
  style
}: {
  bracketMatch: BracketMatch;
  onScore: (matchId: string, score: Score) => void;
  onClearScore: (matchId: string) => void;
  style?: CSSProperties;
}) {
  const { match, home, away, score } = bracketMatch;
  const locked = isApiFinal(match);
  const gameLabel = KNOCKOUT_GAME_LABELS[match.id] ?? phaseLabel(match);
  const pendingReason = home.pendingReason ?? away.pendingReason ?? 'Waiting on earlier result';
  const homeResult = getResultState('home', score, bracketMatch, home.teamId);
  const awayResult = getResultState('away', score, bracketMatch, away.teamId);

  return (
    <article className={match.phase === '3rd-place-match' ? 'bracket-card third-place-card' : 'bracket-card'} style={style}>
      <div className="bracket-card-meta">
        <strong>
          {gameLabel}
          {match.phase === 'round-of-32' ? <InfoTip text={formatRoundOf32SourceInfo(match.id)} /> : null}
          {!home.teamId || !away.teamId ? <InfoTip text={pendingReason} /> : null}
        </strong>
        <span className="bracket-meta-secondary">
          <LiveStatusBadge match={match} />
          {formatShortDate(match.kickoffUtc)}
          <InfoTip text={formatVenueTimeInfo(match)} />
        </span>
      </div>
      <BracketScoreEditor
        home={{ label: home.label, result: homeResult }}
        away={{ label: away.label, result: awayResult }}
        score={score}
        onScore={(next) => onScore(match.id, next)}
        onClear={() => onClearScore(match.id)}
        locked={locked}
      />
    </article>
  );
}

function BracketScoreEditor({
  home,
  away,
  score,
  locked,
  onScore,
  onClear
}: {
  home: { label: string; result: ResultState };
  away: { label: string; result: ResultState };
  score: Score | null;
  locked: boolean;
  onScore: (score: Score) => void;
  onClear: () => void;
}) {
  const [homeScore, setHomeScore] = useState(score ? String(score.home) : '');
  const [awayScore, setAwayScore] = useState(score ? String(score.away) : '');

  useEffect(() => {
    setHomeScore(score ? String(score.home) : '');
    setAwayScore(score ? String(score.away) : '');
  }, [score?.home, score?.away]);

  function update(nextHome: string, nextAway: string) {
    setHomeScore(nextHome);
    setAwayScore(nextAway);
    if (!locked && /^\d+$/.test(nextHome) && /^\d+$/.test(nextAway)) {
      onScore({ home: Number(nextHome), away: Number(nextAway) });
    }
  }

  return (
    <div className="bracket-score-editor">
      <label className={resultClassName('bracket-team', home.result)}>
        <span>{home.label}</span>
        <input
          aria-label="Home score"
          inputMode="numeric"
          min="0"
          disabled={locked}
          value={homeScore}
          onChange={(event) => update(event.target.value, awayScore)}
        />
      </label>
      <label className={resultClassName('bracket-team', away.result)}>
        <span>{away.label}</span>
        <input
          aria-label="Away score"
          inputMode="numeric"
          min="0"
          disabled={locked}
          value={awayScore}
          onChange={(event) => update(homeScore, event.target.value)}
        />
      </label>
      {locked ? null : (
        <button
          className="clear-score bracket-clear"
          aria-label="Clear score override"
          onClick={() => {
            setHomeScore('');
            setAwayScore('');
            onClear();
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function TeamLabel({ team }: { team?: Team }) {
  return (
    <span className="team-label">
      {team?.logoUrl ? <img src={team.logoUrl} alt="" /> : <span className="flag-placeholder" />}
      <span>{team?.name ?? 'TBD'}</span>
    </span>
  );
}

function ScoreEditor({
  score,
  compact = false,
  locked = false,
  clearLabel = 'Clear score override',
  onScore,
  onClear
}: {
  score: Score | null;
  compact?: boolean;
  locked?: boolean;
  clearLabel?: string;
  onScore: (score: Score) => void;
  onClear: () => void;
}) {
  const [home, setHome] = useState(score ? String(score.home) : '');
  const [away, setAway] = useState(score ? String(score.away) : '');

  useEffect(() => {
    setHome(score ? String(score.home) : '');
    setAway(score ? String(score.away) : '');
  }, [score?.home, score?.away]);

  function update(nextHome: string, nextAway: string) {
    setHome(nextHome);
    setAway(nextAway);
    if (!locked && /^\d+$/.test(nextHome) && /^\d+$/.test(nextAway)) {
      onScore({ home: Number(nextHome), away: Number(nextAway) });
    }
  }

  return (
    <div className={compact ? 'score-editor compact' : 'score-editor'}>
      <input
        aria-label="Home score"
        inputMode="numeric"
        min="0"
        disabled={locked}
        value={home}
        onChange={(event) => update(event.target.value, away)}
      />
      <span>–</span>
      <input
        aria-label="Away score"
        inputMode="numeric"
        min="0"
        disabled={locked}
        value={away}
        onChange={(event) => update(home, event.target.value)}
      />
      {locked ? null : (
        <button
          className="clear-score"
          aria-label={clearLabel}
          onClick={() => {
            setHome('');
            setAway('');
            onClear();
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function PredictionSummary({ match, prediction }: { match: Match; prediction?: MatchPrediction }) {
  if (!prediction) {
    return (
      <div className="prediction-summary muted">
        <span>No prediction</span>
        <strong>0 pts</strong>
      </div>
    );
  }

  const actual = match.apiScore;
  const breakdown = actual ? scorePrediction(prediction, actual) : null;
  const pointsText = breakdown
    ? match.completed
      ? `${breakdown.points} ${breakdown.points === 1 ? 'pt' : 'pts'}`
      : `currently ${breakdown.points} ${breakdown.points === 1 ? 'pt' : 'pts'}`
    : 'points pending';
  return (
    <div className="prediction-summary">
      <span>
        Your pick {prediction.homeGoals}-{prediction.awayGoals}
      </span>
      <strong>{pointsText}</strong>
    </div>
  );
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatVenueTimeInfo(match: Match) {
  const venue = match.venue || 'TBA';
  return `Venue: ${venue} · Time: ${formatPacificTime(match.kickoffUtc)}`;
}

function formatRoundOf32SourceInfo(matchId: string) {
  const sources = BRACKET_SOURCES[matchId];
  if (!sources) {
    return 'Source matchup: TBA';
  }
  return `${formatBracketSlotSource(sources[0])} vs ${formatBracketSlotSource(sources[1])}`;
}

function formatBracketSlotSource(source: BracketSlot): string {
  if (source.type === 'winner') {
    return `Winner Group ${source.group}`;
  }
  if (source.type === 'runnerUp') {
    return `Runner-up Group ${source.group}`;
  }
  if (source.type === 'thirdColumn') {
    return `3rd Place ${source.candidates.join('/')}`;
  }
  if (source.type === 'winnerOf') {
    return `Winner of ${KNOCKOUT_GAME_LABELS[source.matchId] ?? 'previous game'}`;
  }
  if (source.type === 'loserOf') {
    return `Loser of ${KNOCKOUT_GAME_LABELS[source.matchId] ?? 'previous game'}`;
  }
  return source.label;
}

function formatTotalGoalsSummary(totalGoals: MatchOdds['totalGoals']) {
  if (!totalGoals) {
    return '';
  }
  const overGoals = Math.floor(totalGoals.line) + 1;
  const underMax = Math.floor(totalGoals.line);
  const pieces = [];
  if (totalGoals.over !== undefined) {
    pieces.push(`${formatPercent(totalGoals.over)} for ${overGoals}+ total goals`);
  }
  if (totalGoals.under !== undefined) {
    pieces.push(`${formatPercent(totalGoals.under)} for 0-${underMax} total goals`);
  }
  return pieces.length ? pieces.join(' · ') : `line is ${formatNumber(totalGoals.line)} total goals`;
}

function isApiFinal(match: Match) {
  return Boolean(match.completed && match.apiScore);
}

function isLiveMatch(match: Match) {
  if (match.completed) {
    return false;
  }
  const status = `${match.status} ${match.statusDetail}`.toLowerCase();
  return (
    Boolean(getLiveMinute(match)) ||
    /in progress|first half|second half|halftime|half time|extra time|penalty/.test(status)
  );
}

function getLiveMinute(match: Match) {
  const detail = match.statusDetail || match.status;
  const minute = detail.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*['′]?/);
  if (!minute) {
    return '';
  }
  return minute[2] ? `${minute[1]}+${minute[2]}'` : `${minute[1]}'`;
}

function resultClassName(base: string, result: ResultState) {
  return result ? `${base} ${result}` : base;
}

function getResultState(
  side: 'home' | 'away',
  score: Score | null,
  bracketMatch: BracketMatch | undefined,
  teamId: string | null
): ResultState {
  if (bracketMatch?.winnerTeamId && teamId) {
    return bracketMatch.winnerTeamId === teamId ? 'winner' : 'loser';
  }
  if (!score) {
    return '';
  }
  if (score.home === score.away) {
    return 'draw';
  }
  const sideWon = side === 'home' ? score.home > score.away : score.away > score.home;
  return sideWon ? 'winner' : 'loser';
}

function mergeOrder<T>(currentOrder: T[], manualOrder: T[]) {
  return [...manualOrder.filter((item) => currentOrder.includes(item)), ...currentOrder.filter((item) => !manualOrder.includes(item))];
}

function getUserDisplayName(user: SupabaseUser) {
  const metadataName = user.user_metadata?.display_name;
  return typeof metadataName === 'string' && metadataName.trim() ? metadataName.trim() : user.email ?? 'Signed in';
}

function mapProfileRow(row: {
  user_id: string;
  display_name: string;
  created_at?: string;
  updated_at?: string;
}): Profile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPredictionRow(row: {
  user_id: string;
  match_id: string;
  home_goals: number;
  away_goals: number;
  source?: 'manual' | 'simulation';
  created_at?: string;
  updated_at?: string;
}): MatchPrediction {
  return {
    userId: row.user_id,
    matchId: row.match_id,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    source: row.source ?? 'manual',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatPredictionError(message: string) {
  return /row-level|policy|permission|violates/i.test(message) ? 'Prediction locked.' : message;
}
