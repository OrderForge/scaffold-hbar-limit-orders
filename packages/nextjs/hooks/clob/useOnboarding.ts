"use client";

import { useCallback } from "react";
import { useClobNetwork } from "./useClobNetwork";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { Orderbook } from "~~/lib/clob/types";
import { OnboardingState, deriveOnboarding, readAssociation, viemChainReader } from "~~/lib/hedera/onboarding";

/**
 * The account's readiness to trade a market, derived from the chain.
 *
 * Deliberately independent of `GET /onboarding/:id/status`: the venue's view is a claim,
 * the mirror node and the contracts are the record. Increment 3 shows both side by side.
 */
export const useOnboarding = (market: Orderbook | null | undefined) => {
  const { address } = useAccount();
  const { mirror, config, network } = useClobNetwork();
  const publicClient = usePublicClient({ chainId: config.chainId });

  return useQuery<OnboardingState | null>({
    queryKey: ["clob", network, "onboarding", market?.id, address],
    enabled: Boolean(market && address && publicClient),
    queryFn: async ({ signal }) => {
      if (!market || !address || !publicClient) return null;
      const association = await readAssociation(mirror, address, signal);
      return deriveOnboarding(market, address as `0x${string}`, config, association, viemChainReader(publicClient));
    },
    // Cheap enough to re-check often, and it must reflect a transaction promptly — but a
    // check that is failing should back off rather than retry every 15 seconds forever.
    refetchInterval: query => (query.state.status === "error" ? 60_000 : 15_000),
    retry: 1,
    staleTime: 5_000,
  });
};

/**
 * Resolve the connected account's Hedera id on demand.
 *
 * `useHederaAccount` is a query and may not have settled when the user signs. A journal
 * record whose `account` field holds an EVM address is still correct but reads badly, so
 * the write path awaits this instead of taking whatever the query happens to hold.
 */
export const useResolveHederaAccountId = () => {
  const { mirror } = useClobNetwork();
  const { address } = useAccount();

  return useCallback(async (): Promise<string | null> => {
    if (!address) return null;
    try {
      return (await mirror.getAccount(address))?.accountId ?? null;
    } catch {
      return null;
    }
  }, [mirror, address]);
};

/** The connected account's Hedera id (`0.0.x`), resolved from its EVM address. */
export const useHederaAccount = () => {
  const { address } = useAccount();
  const { mirror, network } = useClobNetwork();

  return useQuery({
    queryKey: ["mirror", network, "account", address],
    enabled: Boolean(address),
    queryFn: async ({ signal }) => (address ? mirror.getAccount(address, signal) : null),
    staleTime: 30_000,
  });
};
