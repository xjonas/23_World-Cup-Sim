import type { Match, Team } from '../types';
import { PHASE_LABELS } from '../data/constants';

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

export function formatDateTime(iso: string) {
  const date = parseDate(iso);
  if (!date) {
    return 'TBA';
  }
  return `${new Intl.DateTimeFormat(undefined, {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)} PT`;
}

export function formatShortDate(iso: string) {
  const date = parseDate(iso);
  if (!date) {
    return 'TBA';
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone: PACIFIC_TIME_ZONE,
    month: 'short',
    day: 'numeric'
  }).format(date);
}

export function formatPacificTime(iso: string) {
  const date = parseDate(iso);
  if (!date) {
    return 'TBA';
  }
  return `${new Intl.DateTimeFormat(undefined, {
    timeZone: PACIFIC_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)} PT`;
}

export function phaseLabel(match: Match) {
  return PHASE_LABELS[match.phase] ?? match.phase;
}

export function teamName(teamsById: Map<string, Team>, teamId: string | null, fallback = 'TBD') {
  if (!teamId) {
    return fallback;
  }
  return teamsById.get(teamId)?.name ?? fallback;
}

function parseDate(iso: string) {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
