import type { MoneylineProbabilities } from '../types';

export function normalizeAmericanOdds(odds: number | string | null | undefined): number | null {
  if (odds === null || odds === undefined) {
    return null;
  }
  const value = typeof odds === 'number' ? odds : Number(String(odds).replace(/^\+/, ''));
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }
  if (value > 0) {
    return 100 / (value + 100);
  }
  return Math.abs(value) / (Math.abs(value) + 100);
}

export function normalizePolymarketPrices(outcomesJson: string, pricesJson: string): Record<string, number> {
  const outcomes = parseStringArray(outcomesJson);
  const prices = parseStringArray(pricesJson).map(Number);
  const pairs = outcomes
    .map((outcome, index) => [outcome, prices[index]] as const)
    .filter(([, price]) => Number.isFinite(price) && price >= 0);
  const total = pairs.reduce((sum, [, price]) => sum + price, 0);

  if (!pairs.length || total <= 0) {
    return {};
  }

  return Object.fromEntries(pairs.map(([outcome, price]) => [outcome, price / total]));
}

export function normalizeMoneylineProbabilities(
  homeWin: number | null | undefined,
  draw: number | null | undefined,
  awayWin: number | null | undefined
): MoneylineProbabilities | undefined {
  if (homeWin === null || homeWin === undefined || draw === null || draw === undefined || awayWin === null || awayWin === undefined) {
    return undefined;
  }
  const total = homeWin + draw + awayWin;
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total
  };
}

export function normalizeTwoWayProbabilities(
  first: number | null | undefined,
  second: number | null | undefined
): [number, number] | undefined {
  if (first === null || first === undefined || second === null || second === undefined) {
    return undefined;
  }
  const total = first + second;
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return [first / total, second / total];
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
