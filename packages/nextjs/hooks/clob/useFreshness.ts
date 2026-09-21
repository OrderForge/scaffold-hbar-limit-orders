"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookLevel, NormalizedDepth } from "~~/lib/clob/depth";

/**
 * "Updated 1.2s ago", ticking.
 *
 * A quiet order book looks identical to a broken one, so the terminal always shows how
 * fresh its data is rather than leaving the reader to guess.
 */
export const useSecondsSince = (timestamp: number | undefined, tickMs = 250): number | null => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  if (!timestamp) return null;
  return Math.max(0, (now - timestamp) / 1000);
};

export type LevelChange = "added" | "increased" | "decreased";

/**
 * Which price levels changed since the previous snapshot, so the ladder can flash them.
 *
 * On a thin market the best bid and ask can sit still for minutes while the book behind
 * them moves. Without this, a working feed is indistinguishable from a frozen one.
 */
export const useChangedLevels = (depth: NormalizedDepth | null, highlightMs = 1200) => {
  const previous = useRef<Map<string, string>>(new Map());
  const [changes, setChanges] = useState<Map<string, { change: LevelChange; at: number }>>(new Map());
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!depth) return;

    const current = new Map<string, string>();
    const next = new Map(changes);
    const now = Date.now();

    const record = (levels: BookLevel[], side: string) => {
      for (const level of levels) {
        const key = `${side}-${level.price}`;
        current.set(key, level.size);

        const before = previous.current.get(key);
        if (before === undefined) {
          // A level that was not there a moment ago.
          if (previous.current.size > 0) next.set(key, { change: "added", at: now });
        } else if (before !== level.size) {
          next.set(key, { change: compare(before, level.size), at: now });
        }
      }
    };

    record(depth.bids, "bid");
    record(depth.asks, "ask");

    // Drop highlights that have faded.
    for (const [key, entry] of next) {
      if (now - entry.at > highlightMs) next.delete(key);
    }

    previous.current = current;
    setChanges(next);

    // Re-render once more when the last highlight expires, so it clears on a quiet book.
    if (next.size > 0) {
      const timer = setTimeout(() => forceTick(value => value + 1), highlightMs);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth?.lastUpdateId, depth?.timestamp]);

  return useMemo(() => {
    const now = Date.now();
    const active = new Map<string, LevelChange>();
    for (const [key, entry] of changes) {
      if (now - entry.at <= highlightMs) active.set(key, entry.change);
    }
    return active;
  }, [changes, highlightMs]);
};

/** Compare two decimal size strings without going through a JS number. */
const compare = (before: string, after: string): LevelChange => {
  const pad = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return { whole: BigInt(whole || "0"), fraction };
  };
  const a = pad(before);
  const b = pad(after);
  if (a.whole !== b.whole) return b.whole > a.whole ? "increased" : "decreased";
  const length = Math.max(a.fraction.length, b.fraction.length);
  const af = BigInt(a.fraction.padEnd(length, "0") || "0");
  const bf = BigInt(b.fraction.padEnd(length, "0") || "0");
  return bf > af ? "increased" : "decreased";
};
