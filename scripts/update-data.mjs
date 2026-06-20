import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=20260611-20260719';
const KNOCKOUT_URL = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage';

const OUT_DIR = new URL('../src/data/', import.meta.url);
const SCOREBOARD_CACHE = '/tmp/worldcup-espn-scoreboard.json';
const KNOCKOUT_CACHE = '/tmp/wc-knockout-stage.html';

const GROUP_RE = /Group ([A-L])/;
const THIRD_PLACE_COLUMNS = ['1A', '1B', '1D', '1E', '1G', '1I', '1K', '1L'];

async function getText(url, cachePath) {
  if (existsSync(cachePath)) {
    return readFile(cachePath, 'utf8');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function cleanCell(html) {
  return html
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseThirdPlaceMap(html) {
  const start = html.indexOf('Combinations of matches in the round of 32');
  const tableStart = html.indexOf('<table', start);
  const tableEnd = html.indexOf('</table>', tableStart);
  const table = html.slice(tableStart, tableEnd);
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((match) => match[0]);
  const map = {};

  for (const row of rows) {
    const cells = [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map((match) =>
      cleanCell(match[1])
    );
    if (!/^\d+$/.test(cells[0] ?? '')) {
      continue;
    }

    const groups = cells.filter((cell) => /^[A-L]$/.test(cell)).slice(0, 8);
    const assignments = cells.filter((cell) => /^3[A-L]$/.test(cell)).map((cell) => cell[1]);

    if (groups.length !== 8 || assignments.length !== 8) {
      throw new Error(`Could not parse third-place mapping row ${cells[0]}: ${cells.join('|')}`);
    }

    map[[...groups].sort().join('')] = Object.fromEntries(
      THIRD_PLACE_COLUMNS.map((column, index) => [column, assignments[index]])
    );
  }

  if (Object.keys(map).length !== 495) {
    throw new Error(`Expected 495 third-place rows, parsed ${Object.keys(map).length}`);
  }

  return map;
}

function normalizeAmericanOdds(odds) {
  if (odds === null || odds === undefined) {
    return null;
  }
  const value = typeof odds === 'number' ? odds : Number(String(odds).replace(/^\+/, ''));
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }
  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}

function normalizeThreeWay(homeWin, draw, awayWin) {
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

function normalizeTwoWay(first, second) {
  if (first === null || first === undefined || second === null || second === undefined) {
    return undefined;
  }
  const total = first + second;
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return [first / total, second / total];
}

function pickAmericanProbability(side) {
  return (
    normalizeAmericanOdds(side?.current?.odds) ??
    normalizeAmericanOdds(side?.close?.odds) ??
    normalizeAmericanOdds(side?.open?.odds)
  );
}

function parseLine(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value.replace(/^[ou]/i, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickLine(side) {
  return parseLine(side?.current?.line) ?? parseLine(side?.close?.line) ?? parseLine(side?.open?.line);
}

function normalizeOdds(competition, fetchedAt) {
  const rawOdds = competition.odds?.find(Boolean);
  if (!rawOdds) {
    return undefined;
  }
  const moneyline = normalizeThreeWay(
    pickAmericanProbability(rawOdds.moneyline?.home),
    pickAmericanProbability(rawOdds.moneyline?.draw) ?? normalizeAmericanOdds(rawOdds.drawOdds?.moneyLine),
    pickAmericanProbability(rawOdds.moneyline?.away)
  );
  const totalLine = pickLine(rawOdds.total?.over) ?? pickLine(rawOdds.total?.under) ?? rawOdds.overUnder;
  const totalProbabilities = normalizeTwoWay(
    pickAmericanProbability(rawOdds.total?.over),
    pickAmericanProbability(rawOdds.total?.under)
  );

  if (!moneyline && totalLine === undefined) {
    return undefined;
  }

  return {
    provider: `${rawOdds.provider?.displayName ?? rawOdds.provider?.name ?? 'ESPN odds'} via ESPN`,
    fetchedAt,
    moneyline,
    totalGoals:
      totalLine !== undefined
        ? {
            line: totalLine,
            over: totalProbabilities?.[0],
            under: totalProbabilities?.[1]
          }
        : undefined,
    confidence: moneyline ? 'high' : 'medium',
    sourceUrl: rawOdds.link?.href
  };
}

function normalizeScoreboard(raw, fetchedAt) {
  const teams = new Map();
  const matches = [];

  for (const event of raw.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) {
      continue;
    }

    const competitors = [...(competition.competitors ?? [])].sort((a, b) => a.order - b.order);
    for (const competitor of competitors) {
      const team = competitor.team;
      teams.set(String(team.id), {
        id: String(team.id),
        name: team.displayName,
        abbreviation: team.abbreviation || team.shortDisplayName || team.displayName,
        logoUrl: team.logo || team.logos?.[0]?.href || '',
        color: team.color || undefined,
        isPlaceholder: team.isActive === false
      });
    }

    const home = competitors.find((competitor) => competitor.homeAway === 'home') ?? competitors[0];
    const away = competitors.find((competitor) => competitor.homeAway === 'away') ?? competitors[1];
    const statusType = competition.status?.type ?? event.status?.type;
    const state = statusType?.state ?? 'pre';
    const completed = Boolean(statusType?.completed);
    const hasScore = state !== 'pre';
    const group = GROUP_RE.exec(competition.altGameNote ?? '')?.[1];
    const winner = competitors.find((competitor) => competitor.winner);

    matches.push({
      id: String(event.id),
      phase: event.season?.slug ?? 'unknown',
      group: group || undefined,
      kickoffUtc: event.date,
      venue: competition.venue?.fullName ?? event.venue?.displayName ?? '',
      homeTeamId: String(home.team.id),
      awayTeamId: String(away.team.id),
      apiScore: hasScore
        ? {
            home: Number(home.score ?? 0),
            away: Number(away.score ?? 0)
          }
        : null,
      status: statusType?.description ?? 'Scheduled',
      statusDetail: statusType?.shortDetail ?? statusType?.detail ?? '',
      completed,
      winnerTeamId: completed && winner ? String(winner.team.id) : undefined,
      odds: normalizeOdds(competition, fetchedAt)
    });
  }

  matches.sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));

  return {
    fetchedAt,
    source: SCOREBOARD_URL,
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    matches
  };
}

function serializeModule(name, value) {
  return `// Generated by scripts/update-data.mjs.\nexport const ${name} = ${JSON.stringify(value, null, 2)} as const;\n`;
}

await mkdir(OUT_DIR, { recursive: true });

const [scoreboardText, knockoutHtml] = await Promise.all([
  getText(SCOREBOARD_URL, SCOREBOARD_CACHE),
  getText(KNOCKOUT_URL, KNOCKOUT_CACHE)
]);

const snapshot = normalizeScoreboard(JSON.parse(scoreboardText), new Date().toISOString());
const thirdPlaceMap = parseThirdPlaceMap(knockoutHtml);

await writeFile(new URL('snapshot.ts', OUT_DIR), serializeModule('SNAPSHOT', snapshot));
await writeFile(
  new URL('thirdPlaceMap.ts', OUT_DIR),
  `// Generated by scripts/update-data.mjs.\n\nimport type { ThirdPlaceAssignment } from '../types';\n\nexport const THIRD_PLACE_ASSIGNMENT_COLUMNS = ${JSON.stringify(
    THIRD_PLACE_COLUMNS
  )} as const;\n\nexport const THIRD_PLACE_MAP = ${JSON.stringify(
    thirdPlaceMap,
    null,
    2
  )} as const satisfies Record<string, ThirdPlaceAssignment>;\n`
);

console.log(`Wrote ${snapshot.matches.length} matches, ${snapshot.teams.length} teams`);
console.log(`Wrote ${Object.keys(thirdPlaceMap).length} third-place combinations`);
