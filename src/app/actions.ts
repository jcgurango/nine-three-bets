"use server";

import { revalidatePath } from "next/cache";
import { getUser, isAdmin } from "@/lib/auth";
import * as store from "@/lib/store";
import type { Pick, Result } from "@/lib/types";

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
const isPick = (p: unknown): p is Pick => p === "a" || p === "b";

function assert(cond: unknown, message = "Invalid request."): asserts cond {
  if (!cond) throw new store.UserError(message);
}

// ---------------------------------------------------------------- betting

export async function placeBetAction(input: {
  marketId: number;
  pick: Pick;
  stake: number;
  quotedOdds: number;
}): Promise<Result<{ odds: number; payout: number }>> {
  return run(async () => {
    const user = await getUser();
    assert(user, "Log in to place a bet.");
    assert(user.nickname, "Pick a nickname first.");
    assert(isId(input?.marketId) && isPick(input.pick));
    assert(typeof input.quotedOdds === "number" && Number.isFinite(input.quotedOdds));
    return store.placeBet({ ...input, userId: user.id });
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

export async function saveMapAction(input: {
  matchId: number;
  mapNumber: number;
  name: string;
  odds: store.OddsInput[];
}): Promise<Result> {
  return admin(async () => {
    assert(isId(input?.matchId) && isId(input.mapNumber) && Array.isArray(input.odds));
    const validOdds = (o: unknown) => typeof o === "number" && o > 1 && o <= 1000;
    for (const o of input.odds) {
      assert(isId(o?.marketId));
      const empty = o.oddsA == null && o.oddsB == null;
      assert(
        empty || (validOdds(o.oddsA) && validOdds(o.oddsB)),
        "Odds must be decimal odds greater than 1 for both teams (e.g. 1.65 and 2.20).",
      );
    }
    await store.saveMap(
      input.matchId,
      input.mapNumber,
      String(input.name ?? "").trim().slice(0, 30),
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
    assert(isId(matchId) && (mapNumber == null || isId(mapNumber)));
    const changed = await store.bulkSetOpen(matchId, mapNumber, open === true);
    assert(
      changed > 0,
      open ? "Nothing to open. Draft markets need odds for both teams first." : "No open markets to close.",
    );
  });
}

export async function settleMarketAction(marketId: number, result: Pick): Promise<Result> {
  return admin(async () => {
    assert(isId(marketId) && isPick(result));
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
