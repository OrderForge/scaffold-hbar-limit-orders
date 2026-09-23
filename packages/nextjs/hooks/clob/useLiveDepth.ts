"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useClobAuth } from "./useClobAuth";
import { useClobNetwork } from "./useClobNetwork";
import { useDepth } from "./useMarketData";
import { NormalizedDepth, normalizeDepth } from "~~/lib/clob/depth";
import { DepthStream, StreamState } from "~~/lib/clob/depthStream";

export type DepthSource = "stream" | "polling";

export type LiveDepth = {
  depth: NormalizedDepth | null;
  source: DepthSource;
  stream: StreamState | null;
  /** The market exists but serves no depth — closed markets answer 404. */
  unavailable: boolean;
  updatedAt?: number;
};

/**
 * Depth from the WebSocket when the API will allow it, polling when it will not.
 *
 * Both SaucerSwap streams require a JWT, so a keyless visitor cannot have live depth at
 * all — polling is not a fallback for them, it is the only option. Once a wallet signs in,
 * the stream takes over and polling stops.
 *
 * The fallback runs the other way too: if the socket cannot connect, or keeps gapping, the
 * page returns to polling rather than showing a frozen book. A trading client has to
 * survive a dropped socket, so this path is worth having even when the socket works.
 */
export const useLiveDepth = (orderbookId: string, enabled = true): LiveDepth => {
  const { config, network } = useClobNetwork();
  const { session } = useClobAuth();
  const [state, setState] = useState<StreamState | null>(null);
  const streamRef = useRef<DepthStream | null>(null);

  const token = session?.token ?? null;
  const streaming = Boolean(enabled && token && state?.status !== "failed");

  // Polling keeps running until the stream is actually live, so there is never a gap
  // between "socket opened" and "first snapshot applied".
  const poll = useDepth(orderbookId, enabled && (!streaming || state?.status !== "live"));

  useEffect(() => {
    if (!enabled || !token) {
      streamRef.current?.stop();
      streamRef.current = null;
      setState(null);
      return;
    }

    const stream = new DepthStream({
      config,
      orderbookId,
      token,
      fetchSnapshot: async () => {
        const client = new (await import("~~/lib/clob/client")).ClobClient({ config });
        return client.getDepth(orderbookId);
      },
      onState: setState,
    });

    streamRef.current = stream;
    stream.start();

    return () => {
      stream.stop();
      streamRef.current = null;
    };
    // A new token, market or network means a new stream.
  }, [config, network, orderbookId, token, enabled]);

  return useMemo(() => {
    const live = state?.status === "live" && state.snapshot;

    if (live) {
      return {
        depth: normalizeDepth(state.snapshot!),
        source: "stream",
        stream: state,
        unavailable: false,
        updatedAt: state.snapshot!.timestamp,
      };
    }

    return {
      depth: poll.data?.depth ?? null,
      source: "polling",
      stream: state,
      unavailable: poll.data?.unavailable ?? false,
      updatedAt: poll.dataUpdatedAt,
    };
  }, [state, poll.data, poll.dataUpdatedAt]);
};
