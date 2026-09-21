"use client";

import { useEffect, useState } from "react";
import { useClobNetwork } from "./useClobNetwork";
import { useQuery } from "@tanstack/react-query";
import { NormalizedDepth, normalizeDepth } from "~~/lib/clob/depth";
import { MarketNotFoundError } from "~~/lib/clob/errors";
import { Orderbook, marketState } from "~~/lib/clob/types";
import { BOOKS_POLL_INTERVAL_MS, DEPTH_POLL_INTERVAL_MS } from "~~/utils/hedera/constants";

/** Pauses polling while the tab is hidden — a background tab does not need live depth. */
const useIsTabVisible = () => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
};

const marketSortKey = (book: Orderbook) => {
  const state = marketState(book);
  if (state === "OPEN") return 0;
  if (state === "HALTED") return 1;
  return 2;
};

export const useBooks = () => {
  const { client, network } = useClobNetwork();
  const visible = useIsTabVisible();

  return useQuery({
    queryKey: ["clob", network, "books"],
    queryFn: async ({ signal }) => {
      const books = await client.getBooks(signal);
      // Tradeable markets first, then by 24h quote volume — the useful ones on top.
      return [...books].sort((a, b) => {
        const byState = marketSortKey(a) - marketSortKey(b);
        if (byState !== 0) return byState;
        return Number(b.quoteVol24h ?? 0) - Number(a.quoteVol24h ?? 0);
      });
    },
    refetchInterval: visible ? BOOKS_POLL_INTERVAL_MS : false,
    staleTime: 5_000,
  });
};

export const useBook = (orderbookId: string) => {
  const books = useBooks();
  return {
    ...books,
    // `undefined` while loading, `null` once we know the id does not exist.
    data: books.data ? (books.data.find(book => book.id === String(orderbookId)) ?? null) : undefined,
  };
};

export type DepthResult = {
  depth: NormalizedDepth | null;
  /** The market exists but has no depth endpoint response — closed markets answer 404. */
  unavailable: boolean;
};

export const useDepth = (orderbookId: string, enabled = true) => {
  const { client, network } = useClobNetwork();
  const visible = useIsTabVisible();

  return useQuery<DepthResult>({
    queryKey: ["clob", network, "depth", orderbookId],
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return { depth: normalizeDepth(await client.getDepth(orderbookId, signal)), unavailable: false };
      } catch (error) {
        // A closed market and an unknown id both answer 404 here; the caller already knows
        // which it is from /books, so this is "no depth", not "no market".
        if (error instanceof MarketNotFoundError) return { depth: null, unavailable: true };
        throw error;
      }
    },
    refetchInterval: visible ? DEPTH_POLL_INTERVAL_MS : false,
    staleTime: 0,
  });
};

export const useTrades = (orderbookId: string, limit = 25, enabled = true) => {
  const { client, network } = useClobNetwork();
  const visible = useIsTabVisible();

  return useQuery({
    queryKey: ["clob", network, "trades", orderbookId, limit],
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return (await client.getTrades(orderbookId, { limit, signal })).trades;
      } catch (error) {
        if (error instanceof MarketNotFoundError) return [];
        throw error;
      }
    },
    refetchInterval: visible ? DEPTH_POLL_INTERVAL_MS * 2 : false,
  });
};

export { useIsTabVisible };
