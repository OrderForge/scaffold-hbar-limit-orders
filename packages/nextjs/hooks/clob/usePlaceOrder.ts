"use client";

import { useState } from "react";
import { useClobAuth } from "./useClobAuth";
import { useClobNetwork } from "./useClobNetwork";
import { useResolveHederaAccountId } from "./useOnboarding";
import { useQueryClient } from "@tanstack/react-query";
import { hashTypedData } from "viem";
import { useAccount, useSignTypedData } from "wagmi";
import { getApiBase } from "~~/lib/clob/config";
import { notional } from "~~/lib/clob/format";
import { request } from "~~/lib/clob/http";
import {
  ORDER_TYPES,
  OrderSide,
  buildOrderRequest,
  buildResponseSchema,
  cancelResponseSchema,
  describeSaveError,
  readCancelResponse,
  saveResponseSchema,
  toSignableOrder,
  withSignatureMode,
} from "~~/lib/clob/orders";
import { Orderbook, marketLabel } from "~~/lib/clob/types";
import { buildIntent, submitIntent } from "~~/lib/journal";

export type PlaceStage = "idle" | "building" | "journalling" | "signing" | "saving" | "done" | "failed";

export type PlaceResult = {
  orderId: string;
  orderHash?: string;
  status?: string;
  /** True when the order was submitted but the journal write failed. */
  journalPending: boolean;
  /** The venue's nonce for this order — what identifies its fills on-chain. */
  nonce?: string;
  /** Where the intent was recorded, when the journal write succeeded. */
  journal?: { topicId: string; sequenceNumber: number };
};

/**
 * Place an order: build → sign → journal → save.
 *
 * The journal is written **before** the order reaches the venue, so the record of what was
 * signed exists even if submission fails. But journalling must never block a trade: if the
 * topic write fails, the order still goes, and the UI says the journal is pending.
 */
export const usePlaceOrder = (market: Orderbook) => {
  const { address } = useAccount();
  const { config, network } = useClobNetwork();
  const { withAuth } = useClobAuth();
  const resolveHederaAccountId = useResolveHederaAccountId();
  const { signTypedDataAsync } = useSignTypedData();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<PlaceStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaceResult | null>(null);
  const [failedAt, setFailedAt] = useState<PlaceStage | undefined>(undefined);
  // What each step produced, kept as it arrives: if the venue then rejects the order, the
  // nonce and the journal receipt are still worth showing — the intent was recorded.
  const [trail, setTrail] = useState<{ nonce?: string; journal?: PlaceResult["journal"]; journalPending?: boolean }>(
    {},
  );

  const place = async (
    side: OrderSide,
    price: string,
    size: string,
    options: { makerOnly?: boolean; isAMMEnabled?: boolean; deadlineSeconds?: number } = {},
  ): Promise<PlaceResult | null> => {
    if (!address) return null;
    setError(null);
    setResult(null);
    setFailedAt(undefined);
    setTrail({});

    // Tracked locally as well as in state, so a failure knows which step it interrupted.
    let current: PlaceStage = "idle";
    const enter = (next: PlaceStage) => {
      current = next;
      setStage(next);
    };

    const base = getApiBase(config);

    try {
      enter("building");
      const orderRequest = buildOrderRequest(side, price, size, market, options);

      // The server assigns the nonce and may clamp the deadline: sign what it returns.
      const buildPayload = await withAuth(token =>
        request<unknown>(`${base}/orders/build`, {
          method: "POST",
          body: { orderRequests: [orderRequest] },
          token,
          maxAttempts: 1,
        }),
      );

      const built = buildResponseSchema.parse(buildPayload).orders[0];
      const signable = toSignableOrder(built);

      setTrail(previous => ({ ...previous, nonce: String(built.info.nonce) }));

      enter("signing");
      const typedData = {
        domain: {
          name: "PartialFillLimitOrderReactor",
          version: "1",
          chainId: config.chainId,
          verifyingContract: built.info.reactor as `0x${string}`,
        },
        types: ORDER_TYPES,
        primaryType: "PartialFillLimitOrder" as const,
        message: signable,
      };

      const rawSignature = await signTypedDataAsync(typedData);
      const signature = withSignatureMode(rawSignature);

      enter("journalling");
      let journalPending = false;
      let journal: PlaceResult["journal"];
      try {
        const recorded = await submitIntent(
          buildIntent({
            action: "place",
            account: (await resolveHederaAccountId()) ?? address,
            accountEvm: address,
            orderbookId: market.id,
            baseTokenId: market.baseTokenId,
            quoteTokenId: market.quoteTokenId,
            pair: marketLabel(market),
            side,
            price,
            size,
            notional: notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals),
            nonce: String(built.info.nonce),
            // The digest the wallet signed, so the journalled intent can be matched to a
            // settlement later. The signature itself is never journalled.
            eip712Hash: hashTypedData(typedData),
            submitted: true,
          }),
        );
        journal = { topicId: recorded.topicId, sequenceNumber: recorded.sequenceNumber };
        setTrail(previous => ({ ...previous, journal }));
      } catch {
        // Never block a trade on the journal; surface it and offer a retry instead.
        journalPending = true;
        setTrail(previous => ({ ...previous, journalPending: true }));
      }

      enter("saving");
      const savePayload = await withAuth(token =>
        request<unknown>(`${base}/orders/save`, {
          method: "POST",
          body: { items: [{ order: built, signature, orderbookId: market.id, type: "LIMIT" }] },
          token,
          maxAttempts: 1,
        }),
      );

      const saved = saveResponseSchema.parse(savePayload).orders[0];
      const placed: PlaceResult = {
        orderId: saved.meta.id,
        orderHash: saved.meta.orderHash,
        status: saved.meta.status,
        journalPending,
        nonce: String(built.info.nonce),
        journal,
      };

      setResult(placed);
      setStage("done");
      queryClient.invalidateQueries({ queryKey: ["clob", network, "orders"] });
      return placed;
    } catch (cause) {
      setError(describeSaveError(cause));
      setFailedAt(current);
      setStage("failed");
      return null;
    }
  };

  return {
    place,
    stage,
    error,
    result,
    failedAt,
    trail,
    reset: () => (setStage("idle"), setError(null), setResult(null), setFailedAt(undefined), setTrail({})),
  };
};

export type CancelStage = "idle" | "requesting" | "requested" | "confirmed" | "failed";

/**
 * Cancel an order.
 *
 * A 202 means the request was accepted, not that the order is gone — so the UI says
 * "cancel requested" until the order's own history confirms it.
 */
export const useCancelOrder = () => {
  const { config, network, client } = useClobNetwork();
  const { withAuth } = useClobAuth();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<CancelStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const cancel = async (orderId: string) => {
    setError(null);
    setStage("requesting");

    try {
      const payload = await withAuth(token =>
        request<unknown>(`${getApiBase(config)}/cancel`, {
          method: "POST",
          body: { orderIds: [orderId] },
          token,
          maxAttempts: 1,
        }),
      );

      const response = cancelResponseSchema.parse(payload);
      if (readCancelResponse(response, orderId) === "rejected") {
        setError("The venue did not accept the cancellation for this order.");
        setStage("failed");
        return;
      }

      setStage("requested");

      // Poll the order's history until the cancel actually lands.
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const history = await withAuth(token => client.getOrderHistory(orderId, token));
        if (history.events.some(event => event.type.replace(/^ORDER_/, "").toUpperCase() === "CANCELED")) {
          setStage("confirmed");
          queryClient.invalidateQueries({ queryKey: ["clob", network, "orders"] });
          return;
        }
      }
      // Still only "requested": the request was accepted but has not been confirmed yet.
    } catch (cause) {
      setError((cause as Error).message);
      setStage("failed");
    }
  };

  return { cancel, stage, error };
};
