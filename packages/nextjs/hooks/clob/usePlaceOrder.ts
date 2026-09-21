"use client";

import { useState } from "react";
import { useClobAuth } from "./useClobAuth";
import { useClobNetwork } from "./useClobNetwork";
import { useHederaAccount } from "./useOnboarding";
import { useQueryClient } from "@tanstack/react-query";
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
};

/**
 * Place an order: build → journal → sign → save.
 *
 * The journal is written **before** the order reaches the venue, so the record of what was
 * signed exists even if submission fails. But journalling must never block a trade: if the
 * topic write fails, the order still goes, and the UI says the journal is pending.
 */
export const usePlaceOrder = (market: Orderbook) => {
  const { address } = useAccount();
  const { config, network } = useClobNetwork();
  const { withAuth } = useClobAuth();
  const { data: hederaAccount } = useHederaAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<PlaceStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaceResult | null>(null);

  const place = async (
    side: OrderSide,
    price: string,
    size: string,
    options: { makerOnly?: boolean; isAMMEnabled?: boolean; deadlineSeconds?: number } = {},
  ): Promise<PlaceResult | null> => {
    if (!address) return null;
    setError(null);
    setResult(null);

    const base = getApiBase(config);

    try {
      setStage("building");
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

      setStage("signing");
      const rawSignature = await signTypedDataAsync({
        domain: {
          name: "PartialFillLimitOrderReactor",
          version: "1",
          chainId: config.chainId,
          verifyingContract: built.info.reactor as `0x${string}`,
        },
        types: ORDER_TYPES,
        primaryType: "PartialFillLimitOrder",
        message: signable,
      });
      const signature = withSignatureMode(rawSignature);

      setStage("journalling");
      let journalPending = false;
      try {
        await submitIntent(
          buildIntent({
            action: "place",
            account: hederaAccount?.accountId ?? address,
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
            submitted: true,
          }),
        );
      } catch {
        // Never block a trade on the journal; surface it and offer a retry instead.
        journalPending = true;
      }

      setStage("saving");
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
      };

      setResult(placed);
      setStage("done");
      queryClient.invalidateQueries({ queryKey: ["clob", network, "orders"] });
      return placed;
    } catch (cause) {
      setError(describeSaveError(cause));
      setStage("failed");
      return null;
    }
  };

  return { place, stage, error, result, reset: () => (setStage("idle"), setError(null), setResult(null)) };
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
