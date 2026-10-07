"use server";

import { revalidatePath } from "next/cache";
import { getUser, isAdmin } from "@/lib/auth";
import * as store from "@/lib/store";
import { DEFAULT_SETTINGS, type Result, type Settings } from "@/lib/types";

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof store.UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

async function requireAdmin(): Promise<void> {
  if (!isAdmin(await getUser())) throw new store.UserError("Admins only.");
}

function admin(fn: () => Promise<unknown>): Promise<Result> {
  return run(async () => {
    await requireAdmin();
    await fn();
  });
}

const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
const isOutcomeKey = (k: unknown): k is string => typeof k === "string" && /^[a-z0-9-]{1,8}$/.test(k);

function assert(cond: unknown, message = "Invalid request."): asserts cond {
  if (!cond) throw new store.UserError(message);
}

// ---------------------------------------------------------------- betting

export async function placeBetAction(input: {
  marketId: number;
  pick: string;
  stake: number;
  quotedOdds: number;
}): Promise<Result<{ odds: number; payout: number }>> {
  return run(async () => {
    const user = await getUser();
    assert(user, "Log in to place a bet.");
    assert(user.nickname, "Pick a nickname first.");
    assert(isId(input?.marketId) && isOutcomeKey(input.pick));
    assert(typeof input.quotedOdds === "number" && Number.isFinite(input.quotedOdds));
    return store.placeBet({ ...input, userId: user.id });
  });
}

export async function takeLoanAction(amount: number): Promise<Result<{ owed: number }>> {
  return run(async () => {
    const user = await getUser();
    assert(user, "Log in first.");
    assert(Number.isInteger(amount) && amount > 0, "Enter an amount.");
    return store.takeLoan(user.id, amount);
  });
}

export async function repayLoanAction(amount: number): Promise<Result> {
  return run(async () => {
    const user = await getUser();
    assert(user, "Log in first.");
    assert(Number.isInteger(amount) && amount > 0, "Enter an amount.");
    await store.repayLoan(user.id, amount);
  });
}

export async function setNicknameAction(nickname: string): Promise<Result> {
  return run(async () => {
    const user = await getUser();
    assert(user, "Log in first.");
    const clean = String(nickname ?? "").replace(/\s+/g, " ").trim();
    assert(clean.length >= 2 && clean.length <= 20, "Nicknames are 2 to 20 characters.");
    assert(/^[\p{L}\p{N} _.\-]+$/u.test(clean), "Use letters, numbers, spaces, dots, dashes or underscores.");
    await store.setNickname(user.id, clean);
  });
}

// ---------------------------------------------------------------- admin

function cleanMatchInput(input: store.MatchInput): store.MatchInput {
  const label = String(input?.label ?? "").trim().slice(0, 60);
  const teamA = String(input?.teamA ?? "").trim().slice(0, 40);
  const teamB = String(input?.teamB ?? "").trim().slice(0, 40);
  assert(teamA && teamB, "Both team names are required.");
  const startsAt = input.startsAt == null ? null : Math.floor(Number(input.startsAt));
  assert(startsAt == null || Number.isFinite(startsAt), "Invalid start time.");
  return { label, teamA, teamB, startsAt };
}

export async function createMatchAction(input: store.MatchInput & { bestOf: number }): Promise<Result> {
  return admin(async () => {
    assert(input?.bestOf === 1 || input?.bestOf === 3 || input?.bestOf === 5, "Best of must be 1, 3 or 5.");
    await store.createMatch({ ...cleanMatchInput(input), bestOf: input.bestOf });
  });
}

export async function updateMatchAction(id: number, input: store.MatchInput): Promise<Result> {
  return admin(async () => {
    assert(isId(id));
    await store.updateMatch(id, cleanMatchInput(input));
  });
}

export async function saveSettingsAction(input: Settings): Promise<Result> {
  return admin(async () => {
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const value = Number(input?.[key]);
      assert(Number.isInteger(value) && value >= 0 && value <= 1_000_000_000, `${key} must be a whole number.`);
      settings[key] = value;
    }
    assert(settings.exposureCapPct >= 1 && settings.exposureCapPct <= 100, "Exposure cap is a percentage from 1 to 100.");
    assert(settings.garnishPct <= 100, "Garnish is a percentage up to 100.");
    await store.saveSettings(settings);
  });
}

export async function finalizeMatchAction(id: number): Promise<Result> {
  return admin(async () => {
    assert(isId(id));
    await store.finalizeMatch(id);
  });
}

export async function unfinalizeMatchAction(id: number): Promise<Result> {
  return admin(async () => {
    assert(isId(id));
    await store.unfinalizeMatch(id);
  });
}

export async function setMatchArchivedAction(id: number, archived: boolean): Promise<Result> {
  return admin(async () => {
    assert(isId(id));
    await store.setMatchArchived(id, archived === true);
  });
}

export async function deleteMatchAction(id: number): Promise<Result> {
  return admin(async () => {
    assert(isId(id));
    await store.deleteMatch(id);
  });
}

export async function saveOddsAction(input: {
  matchId: number;
  /** A map, or 0 for the match-level markets. */
  mapNumber: number;
  mapName: string;
  odds: store.OddsInput[];
}): Promise<Result> {
  return admin(async () => {
    assert(isId(input?.matchId) && Number.isInteger(input.mapNumber) && Array.isArray(input.odds));
    for (const o of input.odds) {
      assert(isId(o?.marketId) && o.odds && typeof o.odds === "object");
      for (const [key, value] of Object.entries(o.odds)) {
        assert(isOutcomeKey(key));
        assert(
          value == null || (typeof value === "number" && value > 1 && value <= 1000),
          "Odds must be decimal odds greater than 1 (e.g. 1.65).",
        );
      }
    }
    await store.saveOdds(
      input.matchId,
      input.mapNumber,
      String(input.mapName ?? "").trim().slice(0, 30),
      input.odds,
    );
  });
}

export async function setMarketOpenAction(marketId: number, open: boolean): Promise<Result> {
  return admin(async () => {
    assert(isId(marketId));
    await store.setMarketOpen(marketId, open === true);
  });
}

export async function bulkSetOpenAction(
  matchId: number,
  mapNumber: number | null,
  open: boolean,
): Promise<Result> {
  return admin(async () => {
    assert(isId(matchId) && (mapNumber == null || (Number.isInteger(mapNumber) && mapNumber >= 0)));
    const changed = await store.bulkSetOpen(matchId, mapNumber, open === true);
    assert(
      changed > 0,
      open ? "Nothing to open. Draft markets need odds for every outcome first." : "No open markets to close.",
    );
  });
}

export async function settleMarketAction(marketId: number, result: string): Promise<Result> {
  return admin(async () => {
    assert(isId(marketId) && isOutcomeKey(result));
    await store.settleMarket(marketId, result);
  });
}

export async function voidMarketAction(marketId: number): Promise<Result> {
  return admin(async () => {
    assert(isId(marketId));
    await store.voidMarket(marketId);
  });
}

export async function unsettleMarketAction(marketId: number): Promise<Result> {
  return admin(async () => {
    assert(isId(marketId));
    await store.unsettleMarket(marketId);
  });
}
