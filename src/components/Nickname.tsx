"use client";

import { useState, useTransition } from "react";
import { setNicknameAction } from "@/app/actions";
import { Avatar } from "./Avatar";

/**
 * Asks the player what to be called. With no `onClose` it can't be dismissed,
 * which is how new players are held until they pick a name.
 */
export function NicknameDialog({ current, onClose }: { current?: string; onClose?: () => void }) {
  const [name, setName] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const res = await setNicknameAction(name);
      if (res.ok) onClose?.();
      else setError(res.error);
    });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nickname-title"
    >
      <form
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="nickname-title" className="font-display text-2xl font-bold uppercase tracking-wide">
          {current ? "Change your nickname" : "Pick a nickname"}
        </h2>
        <p className="mt-1 text-sm text-mute">
          This is the name everyone sees on the leaderboard. Your Discord name stays private.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="Nickname"
          aria-label="Nickname"
          autoComplete="off"
          className="mt-4 w-full rounded border border-line bg-ink px-3 py-2 outline-none focus:border-bone/60"
        />
        {error && <p className="mt-2 text-sm text-val">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line px-4 py-1.5 text-sm font-semibold text-mute hover:text-bone"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={pending || name.trim().length < 2}
            className="rounded bg-val px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {pending ? "Saving…" : current ? "Save" : "Let's go"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The player's avatar and nickname in the header; click to rename. */
export function NicknameButton({ nickname, avatarUrl }: { nickname: string; avatarUrl: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Change your nickname"
        className="hidden items-center gap-2 hover:text-gold sm:flex"
      >
        <Avatar url={avatarUrl} name={nickname} />
        <span className="max-w-32 truncate">{nickname}</span>
      </button>
      {open && <NicknameDialog current={nickname} onClose={() => setOpen(false)} />}
    </>
  );
}
