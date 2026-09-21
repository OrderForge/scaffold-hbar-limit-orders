"use client";

import { useClobAuth } from "./useClobAuth";
import { useClobNetwork } from "./useClobNetwork";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { AccountOrder, Fees, OnboardingStatus } from "~~/lib/clob/types";

/** Fee rates for both sides, as the venue applies them to this account. */
export const useFees = (orderbookId: string | undefined) => {
  const { client, network } = useClobNetwork();
  const { isSignedIn, withAuth } = useClobAuth();

  return useQuery<{ maker: Fees; taker: Fees } | null>({
    queryKey: ["clob", network, "fees", orderbookId, isSignedIn],
    enabled: Boolean(orderbookId && isSignedIn),
    queryFn: async ({ signal }) => {
      if (!orderbookId) return null;
      return withAuth(async token => {
        const [maker, taker] = await Promise.all([
          client.getFees(orderbookId, "maker", token, signal),
          client.getFees(orderbookId, "taker", token, signal),
        ]);
        return { maker, taker };
      });
    },
    staleTime: 60_000,
  });
};

/**
 * The venue's own onboarding verdict, for comparison with what we read from the chain.
 * They should agree; when they do not, the chain wins and the UI says so.
 */
export const useVenueOnboarding = (orderbookId: string | undefined) => {
  const { client, network } = useClobNetwork();
  const { isSignedIn, withAuth } = useClobAuth();

  return useQuery<OnboardingStatus | null>({
    queryKey: ["clob", network, "venue-onboarding", orderbookId, isSignedIn],
    enabled: Boolean(orderbookId && isSignedIn),
    queryFn: async ({ signal }) => {
      if (!orderbookId) return null;
      return withAuth(token => client.getOnboardingStatus(orderbookId, token, signal));
    },
    refetchInterval: 30_000,
  });
};

/** The authenticated account's orders. Polled; the WebSocket arrives in the next increment. */
export const useOrders = () => {
  const { client, network } = useClobNetwork();
  const { address } = useAccount();
  const { isSignedIn, withAuth } = useClobAuth();

  return useQuery<AccountOrder[]>({
    queryKey: ["clob", network, "orders", address, isSignedIn],
    enabled: Boolean(isSignedIn && address),
    queryFn: ({ signal }) => withAuth(token => client.getOrders(token, { signal })),
    refetchInterval: 10_000,
  });
};

export const useOrderHistory = (orderId: string | null) => {
  const { client, network } = useClobNetwork();
  const { isSignedIn, withAuth } = useClobAuth();

  return useQuery({
    queryKey: ["clob", network, "order-history", orderId, isSignedIn],
    enabled: Boolean(orderId && isSignedIn),
    queryFn: ({ signal }) => withAuth(token => client.getOrderHistory(orderId as string, token, signal)),
  });
};
