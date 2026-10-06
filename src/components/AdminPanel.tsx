"use client";

import { useEffect, useState, useTransition } from "react";
import {
  bulkSetOpenAction,
  createMatchAction,
  deleteMatchAction,
  saveOddsAction,
  setMarketOpenAction,
  setMatchArchivedAction,
  settleMarketAction,
  unsettleMarketAction,
  updateMatchAction,
  voidMarketAction,
} from "@/app/actions";
import { oddsText } from "@/lib/format";
import { quote } from "@/lib/odds";
import { outcomeLabel, outcomeSide } from "@/lib/outcomes";
import { KIND_LABEL, type Market, type MarketStatus, type Match, type Result } from "@/lib/types";
import { Credits } from "./Credits";
import { LocalTime } from "./LocalTime";

const input =
  "rounded border border-line bg-ink px-2.5 py-1.5 text-sm outline-none focus:border-bone/60";
const btn =
  "rounded border border-line bg-raised px-2.5 py-1 text-xs font-semibold hover:border-bone/50 disabled:opacity-40";

/** Runs server actions one at a time and surfaces their error message. */
function useRun() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) after?.();
      else setError(res.error);
    });
  return { pending, error, run };
}

/** A button that needs a second click within a few seconds to fire. */
function ConfirmButton({
  onConfirm,
  disabled,
  className = btn,
  children,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  // Width the button had before arming, held while armed so its neighbours don't move under the cursor.
  const [armedWidth, setArmedWidth] = useState<number | null>(null);
  const armed = armedWidth != null;
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmedWidth(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${className} ${armed ? "border-gold! text-gold!" : ""}`}
      style={armed ? { width: armedWidth } : undefined}
      onClick={(e) => {
        if (armed) onConfirm();
        setArmedWidth(armed ? null : e.currentTarget.offsetWidth);
      }}
    >
      {armed ? "Sure?" : children}
    </button>
  );
}

export function AdminPanel({ active, archived }: { active: Match[]; archived: Match[] }) {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide">Admin</h1>
        <ol className="mt-2 list-inside list-decimal space-y-0.5 text-sm text-mute">
          <li>Add the match, then type in the odds from your source for each map and save.</li>
          <li>Open the markets to take bets. Close each one when its map or round starts.</li>
          <li>
            Click <b>Won</b> next to the result to pay out. Void refunds everyone (e.g. a map that
            isn&apos;t played).
          </li>
        </ol>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide">New match</h2>
        <MatchForm submitLabel="Add match" />
      </section>

      {active.length === 0 && <p className="text-sm text-mute">No active matches.</p>}
      {active.map((m) => (
        <AdminMatch key={m.id} match={m} />
      ))}

      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer font-display text-lg font-bold uppercase tracking-wide text-mute">
            Archived matches ({archived.length})
          </summary>
          <div className="mt-4 space-y-8">
            {archived.map((m) => (
              <AdminMatch key={m.id} match={m} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Unix seconds -> value for a datetime-local input, in the browser's time zone. */
function toLocalInput(ts: number | null): string {
  if (ts == null) return "";
  const d = new Date(ts * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function MatchForm({
  match,
  submitLabel,
  onDone,
}: {
  match?: Match;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [teamA, setTeamA] = useState(match?.teamA ?? "");
  const [teamB, setTeamB] = useState(match?.teamB ?? "");
  const [label, setLabel] = useState(match?.label ?? "");
  const [bestOf, setBestOf] = useState(match?.bestOf ?? 3);
  const [startsAt, setStartsAt] = useState(() => toLocalInput(match?.startsAt ?? null));
  const { pending, error, run } = useRun();

  const submit = () => {
    const fields = {
      teamA,
      teamB,
      label,
      startsAt: startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : null,
    };
    run(
      () => (match ? updateMatchAction(match.id, fields) : createMatchAction({ ...fields, bestOf })),
      () => {
        if (!match) {
          setTeamA("");
          setTeamB("");
        }
        onDone?.();
      },
    );
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Team A">
        <input className={`${input} w-40`} value={teamA} onChange={(e) => setTeamA(e.target.value)} required />
      </Field>
      <Field label="Team B">
        <input className={`${input} w-40`} value={teamB} onChange={(e) => setTeamB(e.target.value)} required />
      </Field>
      <Field label="Stage (optional)">
        <input
          className={`${input} w-44`}
          value={label}
          placeholder="Upper final"
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      {!match && (
        <Field label="Format">
          <select className={input} value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
            <option value={1}>Bo1</option>
            <option value={3}>Bo3</option>
            <option value={5}>Bo5</option>
          </select>
        </Field>
      )}
      <Field label="Start time (your time zone)">
        <input
          type="datetime-local"
          className={input}
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-val px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40"
      >
        {submitLabel}
      </button>
      {onDone && (
        <button type="button" className={`${btn} py-1.5`} onClick={onDone}>
          Cancel
        </button>
      )}
      {error && <p className="w-full text-sm text-val">{error}</p>}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-mute">
      {label}
      {children}
    </label>
  );
}

function AdminMatch({ match }: { match: Match }) {
  const [editing, setEditing] = useState(false);
  const { pending, error, run } = useRun();
  // Group 0 is the match-level markets (absent for a best of 1), then one group per map.
  const groups = [...new Set(match.markets.map((m) => m.mapNumber))].sort((x, y) => x - y);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-display text-2xl font-bold uppercase tracking-wide">
            <span className="text-val">{match.teamA}</span>{" "}
            <span className="text-base text-mute">vs</span>{" "}
            <span className="text-teal">{match.teamB}</span>
          </h2>
          <span className="text-xs uppercase tracking-wider text-mute">
            {[match.label, `Bo${match.bestOf}`].filter(Boolean).join(" · ")}
            {match.startsAt != null && (
              <>
                {" · "}
                <LocalTime ts={match.startsAt} />
              </>
            )}
          </span>
          {match.scrapedAt != null && (
            <span className="text-xs text-mute">
              Scraped odds last received <LocalTime ts={match.scrapedAt} />
            </span>
          )}
        </div>
        {editing ? (
          <MatchForm match={match} submitLabel="Save" onDone={() => setEditing(false)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={pending} onClick={() => run(() => bulkSetOpenAction(match.id, null, true))}>
              Open all drafts
            </button>
            <button className={btn} disabled={pending} onClick={() => run(() => bulkSetOpenAction(match.id, null, false))}>
              Close all open
            </button>
            <button className={btn} onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button
              className={btn}
              disabled={pending}
              onClick={() => run(() => setMatchArchivedAction(match.id, !match.archived))}
              title="Archived matches are hidden from the home page"
            >
              {match.archived ? "Unarchive" : "Archive (hide from home)"}
            </button>
            <ConfirmButton disabled={pending} onConfirm={() => run(() => deleteMatchAction(match.id))}>
              Delete
            </ConfirmButton>
          </div>
        )}
        {error && <p className="text-sm text-val">{error}</p>}
      </header>
      {groups.map((n) => (
        <AdminGroup
          key={n}
          match={match}
          mapNumber={n}
          markets={match.markets.filter((m) => m.mapNumber === n)}
        />
      ))}
    </section>
  );
}

const STATUS_STYLE: Record<MarketStatus, string> = {
  draft: "bg-raised text-mute",
  open: "bg-teal/15 text-teal",
  closed: "bg-gold/15 text-gold",
  settled: "bg-bone/10 text-bone",
  void: "bg-raised text-mute line-through",
};

const oddsField = (n: number | null) => (n == null ? "" : String(n));
const parseOdds = (s: string) => (s.trim() === "" ? null : Number(s));

/** One block of a match's markets: a map, or the match-level markets when `mapNumber` is 0. */
function AdminGroup({
  match,
  mapNumber,
  markets,
}: {
  match: Match;
  mapNumber: number;
  markets: Market[];
}) {
  const isMap = mapNumber > 0;
  const savedName = match.mapNames[mapNumber - 1] ?? "";
  // Only what the admin has typed and not yet saved is kept here. Every other
  // field shows the saved value, so odds arriving from the scraper appear live
  // and are never overwritten by a stale copy from when the page loaded.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { pending, error, run } = useRun();

  const name = nameEdit ?? savedName;
  const shown = (m: Market, key: string, saved: number | null) =>
    edits[`${m.id}:${key}`] ?? oddsField(saved);
  const dirty =
    name !== savedName ||
    markets.some((m) => m.outcomes.some((o) => parseOdds(shown(m, o.key, o.odds)) !== o.odds));

  const save = async () => {
    const res = await saveOddsAction({
      matchId: match.id,
      mapNumber,
      mapName: name,
      odds: markets.map((m) => ({
        marketId: m.id,
        odds: Object.fromEntries(m.outcomes.map((o) => [o.key, parseOdds(shown(m, o.key, o.odds))])),
      })),
    });
    if (res.ok) {
      setEdits({});
      setNameEdit(null);
    }
    return res;
  };

  /** Run a status change, saving any unsaved odds first so they aren't lost or ignored. */
  const act = (fn: () => Promise<Result>) =>
    run(async () => {
      if (dirty) {
        const saved = await save();
        if (!saved.ok) return saved;
      }
      return fn();
    });

  const setOne = (id: number, key: string, value: string) =>
    setEdits((e) => ({ ...e, [`${id}:${key}`]: value }));

  return (
    <div className="border-b border-line p-4 last:border-b-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-bold uppercase tracking-wide">
          {isMap ? `Map ${mapNumber}` : "Full match"}
        </h3>
        {isMap && (
          <input
            className={`${input} w-36`}
            placeholder="Map name"
            aria-label={`Map ${mapNumber} name`}
            value={name}
            onChange={(e) => setNameEdit(e.target.value)}
          />
        )}
        <button
          className={`${btn} ${dirty ? "border-val! text-val!" : ""}`}
          disabled={pending || !dirty}
          onClick={() => run(save)}
        >
          {dirty ? (isMap ? "Save odds & name" : "Save odds") : "Saved"}
        </button>
        <span className="ml-auto flex gap-2">
          <button className={btn} disabled={pending} onClick={() => act(() => bulkSetOpenAction(match.id, mapNumber, true))}>
            {isMap ? "Open map" : "Open both"}
          </button>
          <button className={btn} disabled={pending} onClick={() => act(() => bulkSetOpenAction(match.id, mapNumber, false))}>
            {isMap ? "Close map" : "Close both"}
          </button>
        </span>
      </div>

      <div className="space-y-2">
        {markets.map((m) => {
          const locked = m.status === "settled" || m.status === "void";
          const canSettle = m.status === "open" || m.status === "closed";
          return (
            <div key={m.id} className="rounded bg-ink/40 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-sm font-medium">{KIND_LABEL[m.kind]}</span>
                <span className={`w-16 rounded px-1.5 py-0.5 text-center text-xs font-bold uppercase ${STATUS_STYLE[m.status]}`}>
                  {m.status}
                </span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {(m.status === "draft" || m.status === "closed") && (
                    <button className={btn} disabled={pending} onClick={() => act(() => setMarketOpenAction(m.id, true))}>
                      {m.status === "draft" ? "Open" : "Reopen"}
                    </button>
                  )}
                  {m.status === "open" && (
                    <button className={btn} disabled={pending} onClick={() => act(() => setMarketOpenAction(m.id, false))}>
                      Close
                    </button>
                  )}
                  {!locked && (
                    <ConfirmButton disabled={pending} onConfirm={() => act(() => voidMarketAction(m.id))}>
                      Void
                    </ConfirmButton>
                  )}
                  {locked && (
                    <ConfirmButton disabled={pending} onConfirm={() => run(() => unsettleMarketAction(m.id))}>
                      {m.status === "settled" ? "Undo payout" : "Undo void"}
                    </ConfirmButton>
                  )}
                </span>
              </div>
              <div className="mt-2 grid gap-x-6 gap-y-2 lg:grid-cols-2">
                {m.outcomes.map((o) => {
                  const q = quote(m.outcomes, o.key);
                  const label = outcomeLabel(o.key, match.teamA, match.teamB);
                  return (
                    <div key={o.key} className="flex items-center gap-2 text-xs text-mute">
                      <label className="flex items-center gap-2">
                        <span
                          className={`w-28 truncate ${outcomeSide(o.key) === "a" ? "text-val" : "text-teal"}`}
                        >
                          {label}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="1.01"
                          placeholder="odds"
                          disabled={locked}
                          className={`${input} w-20 font-mono disabled:opacity-50`}
                          value={shown(m, o.key, o.odds)}
                          onChange={(e) => setOne(m.id, o.key, e.target.value)}
                        />
                      </label>
                      <span className="min-w-32 flex-1">
                        {q ? <>Live {oddsText(q.odds)} · </> : null}
                        <Credits n={o.stake} /> staked
                      </span>
                      {m.result === o.key && <span className="font-bold uppercase text-gold">Won</span>}
                      {canSettle && (
                        <ConfirmButton
                          disabled={pending}
                          onConfirm={() => act(() => settleMarketAction(m.id, o.key))}
                        >
                          <span className="sr-only">{label} </span>Won
                        </ConfirmButton>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-val">{error}</p>}
    </div>
  );
}
