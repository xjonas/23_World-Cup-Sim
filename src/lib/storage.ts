import type { SimulationState } from '../types';

const STORAGE_KEY = 'world-cup-2026-sim-state-v1';

export const EMPTY_SIMULATION_STATE: SimulationState = {
  scoreOverrides: {},
  scoreSources: {},
  simulationOdds: {},
  manualGroupOrders: {},
  manualThirdPlaceOrder: [],
  manualKnockoutWinners: {}
};

export function loadSimulationState(): SimulationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return EMPTY_SIMULATION_STATE;
    }
    const parsed = JSON.parse(raw);
    const state = {
      ...EMPTY_SIMULATION_STATE,
      ...parsed,
      scoreOverrides: parsed.scoreOverrides ?? {},
      scoreSources: parsed.scoreSources ?? {},
      simulationOdds: parsed.simulationOdds ?? {}
    };
    for (const matchId of Object.keys(state.scoreOverrides)) {
      state.scoreSources[matchId] ??= 'manual';
    }
    return state;
  } catch {
    return EMPTY_SIMULATION_STATE;
  }
}

export function saveSimulationState(state: SimulationState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}
