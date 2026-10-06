import { UserError } from "./errors";
import type { MarketKind } from "./types";

/**
 * Parsing for odds scraped from an external bookmaker page (see /ingest).
 * Everything here is pure: it turns the scraped payload into odds for our own
 * markets, with outcome keys relative to the scraped team order ("a" is the
 * first scraped team). The store then finds the match and applies them.
 */

export interface ParsedMarket {
  /** The scraped market title this came from. */
  title: string;
  /** 1-based map, or 0 for a market on the whole match. */
  mapNumber: number;
  kind: MarketKind;
  /** Decimal odds by outcome key: "a"/"b", or a score like "2-1" with the first scraped team's maps first. */
  odds: Record<string, number>;
}

export interface Skipped {
  title: string;
  reason: string;
}

export interface ParsedScrape {
  /** Id of the match on the scraped site, used to recognise it next time. */
  externalId: string | null;
  teams: [string, string];
  tournament: string;
  /** Series length implied by the markets on offer, used when the match has to be created. */
  bestOf: number;
  /** Unix milliseconds. */
  scrapedAt: number;
  markets: ParsedMarket[];
  skipped: Skipped[];
}

// ---------------------------------------------------------------- team names

/** Words bookmakers and admins add or drop freely ("G2" vs "G2 Esports"). */
const FILLER = new Set(["esports", "esport", "gaming", "team", "club", "gg"]);

function nameTokens(name: string): string[] {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const core = tokens.filter((t) => !FILLER.has(t));
  return core.length ? core : tokens;
}

/**
 * Whether two spellings refer to the same team. Tolerates case, punctuation
 * and filler words ("G2" = "G2 Esports"), one name being the start of the
 * other ("100T" = "100 Thieves", "Sen" = "Sentinels") and initials
 * ("KC" = "Karmine Corp"). Abbreviations that are neither, like "FNC" for
 * "Fnatic" or "PRX" for "Paper Rex", are not recognised.
 */
export function sameTeam(x: string, y: string): boolean {
  const tx = nameTokens(x);
  const ty = nameTokens(y);
  const cx = tx.join("");
  const cy = ty.join("");
  if (!cx || !cy) return false;
  if (cx === cy) return true;
  const [short, long, longTokens] = cx.length <= cy.length ? [cx, cy, ty] : [cy, cx, tx];
  if (short.length >= 3 && long.startsWith(short)) return true;
  return longTokens.length > 1 && short === longTokens.map((t) => t[0]).join("");
}

/** Index (0 or 1) of the scraped team an outcome name refers to. */
function teamIndex(name: string, teams: [string, string]): 0 | 1 | null {
  const first = sameTeam(name, teams[0]);
  const second = sameTeam(name, teams[1]);
  if (first === second) return null;
  return first ? 0 : 1;
}

// ---------------------------------------------------------------- orientation

/** Swap an outcome key to the other team's point of view: a <-> b, "2-1" <-> "1-2". */
export function flipKey(key: string): string {
  if (key === "a") return "b";
  if (key === "b") return "a";
  const [x, y] = key.split("-");
  return `${y}-${x}`;
}

/** Odds re-keyed for a match that lists the two teams in the opposite order. */
export function flipOdds(odds: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(odds).map(([k, v]) => [flipKey(k), v]));
}

// ---------------------------------------------------------------- market titles

const MAP = String.raw`map\s*(\d+)\s*[-–—:]?\s*`;
const MATCH_WINNER = /^(match\s+)?winner(\s*\(.*\))?$/i;
const MAP_WINNER = new RegExp(`^${MAP}winner\\b`, "i");
const CORRECT_SCORE = /^correct\s+(map\s+)?score$/i;
/** Both pistol rounds in one market, with outcomes like "100 Thieves 1st". */
const MAP_PISTOLS = new RegExp(`^${MAP}pistol\\s+rounds?\\s+winner$`, "i");
/** One pistol round per market, e.g. "Map 1 - 2nd pistol round winner". */
const MAP_ONE_PISTOL = new RegExp(`^${MAP}(1st|2nd|first|second)\\s+pistol\\b`, "i");
const ROUND_SUFFIX = /^(.*?)\s+(1st|2nd|first|second)$/i;
const SCORE = /^(\d+)\s*[:-]\s*(\d+)$/;

const isSecond = (word: string) => /^(2nd|second)$/i.test(word);

/** Odds for the two teams from outcomes named after them, or why that failed. */
function teamOdds(
  outcomes: [string, number][],
  teams: [string, string],
): Record<string, number> | string {
  const odds: Record<string, number> = {};
  for (const [name, value] of outcomes) {
    const index = teamIndex(name, teams);
    if (index == null) return `"${name}" isn't one of the two teams`;
    odds[index === 0 ? "a" : "b"] = value;
  }
  return "a" in odds && "b" in odds ? odds : "needs odds for both teams";
}

/** Turn one scraped market into zero or more of ours, or say why it was skipped. */
function parseMarket(
  title: string,
  outcomes: [string, number][],
  teams: [string, string],
): ParsedMarket[] | string {
  const clean = title.trim();
  if (outcomes.some(([, v]) => typeof v !== "number" || !(v > 1) || v > 1000)) {
    return "odds must be decimal odds greater than 1";
  }

  const team = (mapNumber: number, kind: MarketKind, entries = outcomes) => {
    const odds = teamOdds(entries, teams);
    return typeof odds === "string" ? odds : [{ title, mapNumber, kind, odds }];
  };

  if (MATCH_WINNER.test(clean)) return team(0, "match");

  let m = MAP_WINNER.exec(clean);
  if (m) return team(Number(m[1]), "map");

  if (CORRECT_SCORE.test(clean)) {
    const odds: Record<string, number> = {};
    for (const [name, value] of outcomes) {
      const score = SCORE.exec(name.trim());
      if (!score) return `"${name}" isn't a map score`;
      odds[`${Number(score[1])}-${Number(score[2])}`] = value;
    }
    return [{ title, mapNumber: 0, kind: "score", odds }];
  }

  m = MAP_ONE_PISTOL.exec(clean);
  if (m) return team(Number(m[1]), isSecond(m[2]) ? "pistol2" : "pistol1");

  m = MAP_PISTOLS.exec(clean);
  if (m) {
    const rounds: Record<"pistol1" | "pistol2", [string, number][]> = { pistol1: [], pistol2: [] };
    for (const [name, value] of outcomes) {
      const parts = ROUND_SUFFIX.exec(name.trim());
      if (!parts) return `can't tell which pistol round "${name}" is for`;
      rounds[isSecond(parts[2]) ? "pistol2" : "pistol1"].push([parts[1], value]);
    }
    const parsed: ParsedMarket[] = [];
    for (const kind of ["pistol1", "pistol2"] as const) {
      if (rounds[kind].length === 0) continue;
      const result = team(Number(m[1]), kind, rounds[kind]);
      if (typeof result === "string") return result;
      parsed.push(...result);
    }
    return parsed;
  }

  return "not a market this site offers";
}

// ---------------------------------------------------------------- payload

/** The series length the scraped markets imply: from the scores on offer, else from the maps listed. */
function inferBestOf(markets: ParsedMarket[]): number {
  const score = markets.find((m) => m.kind === "score");
  if (score) {
    const toWin = Math.max(...Object.keys(score.odds).flatMap((k) => k.split("-").map(Number)));
    return toWin * 2 - 1;
  }
  const maps = Math.max(0, ...markets.map((m) => m.mapNumber));
  if (maps <= 1) return 1;
  return maps % 2 === 1 ? maps : maps + 1;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a scraped payload and work out which of our markets each of its markets feeds. */
export function parseScrape(payload: unknown): ParsedScrape {
  if (!isRecord(payload)) throw new UserError("Expected a JSON object.");
  const { teams, markets } = payload;
  if (
    !Array.isArray(teams) ||
    teams.length !== 2 ||
    !teams.every((t) => typeof t === "string" && t.trim())
  ) {
    throw new UserError('"teams" must be the two team names.');
  }
  const pair: [string, string] = [teams[0].trim().slice(0, 40), teams[1].trim().slice(0, 40)];
  if (sameTeam(pair[0], pair[1])) throw new UserError("The two team names look like the same team.");
  if (!isRecord(markets)) throw new UserError('"markets" must be an object of market title to odds.');

  const parsed: ParsedMarket[] = [];
  const skipped: Skipped[] = [];
  for (const [title, outcomes] of Object.entries(markets)) {
    const result = isRecord(outcomes)
      ? parseMarket(title, Object.entries(outcomes) as [string, number][], pair)
      : "expected an object of outcome to odds";
    if (typeof result === "string") skipped.push({ title, reason: result });
    else parsed.push(...result);
  }

  const scrapedAt = typeof payload.scrapedAt === "string" ? Date.parse(payload.scrapedAt) : NaN;
  return {
    externalId: typeof payload.matchId === "string" && payload.matchId ? payload.matchId.slice(0, 200) : null,
    teams: pair,
    tournament: typeof payload.tournament === "string" ? payload.tournament.trim().slice(0, 60) : "",
    bestOf: inferBestOf(parsed),
    scrapedAt: Number.isFinite(scrapedAt) ? scrapedAt : Date.now(),
    markets: parsed,
    skipped,
  };
}
