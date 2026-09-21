"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useClobNetwork } from "./useClobNetwork";
import { useAccount, useSignMessage } from "wagmi";
import { AuthSession, AuthStore, httpAuthTransport } from "~~/lib/clob/auth";
import { getApiBase } from "~~/lib/clob/config";

type ClobAuthValue = {
  session: AuthSession | null;
  isSignedIn: boolean;
  isSigningIn: boolean;
  error: string | null;
  signIn: () => Promise<AuthSession | null>;
  signOut: () => void;
  /** Run an authenticated call, signing in first and refreshing once on a 401. */
  withAuth: <T>(call: (token: string) => Promise<T>) => Promise<T>;
};

const ClobAuthContext = createContext<ClobAuthValue | null>(null);

/**
 * Wallet login for the Orderbook API.
 *
 * The token lives in memory for the lifetime of the page and nowhere else — a reload means
 * signing again, which is one wallet click and keeps a bearer token off disk. The store is
 * rebuilt whenever the account or network changes, so a token can never be reused across
 * either.
 */
export const ClobAuthProvider = ({ children }: { children: ReactNode }) => {
  const { address } = useAccount();
  const { config, network } = useClobNetwork();
  const { signMessageAsync } = useSignMessage();

  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const store = useMemo(() => new AuthStore(httpAuthTransport(getApiBase(config)), network), [config, network]);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    setSession(null);
    setError(null);
    const unsubscribe = store.subscribe(setSession);
    return () => {
      // Dropping the store drops the token with it.
      store.clear();
      unsubscribe();
    };
  }, [store]);

  // A different wallet must never inherit the previous account's token.
  useEffect(() => {
    storeRef.current.clear();
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address) return null;
    setIsSigningIn(true);
    setError(null);
    try {
      return await storeRef.current.signIn(address, message => signMessageAsync({ message }));
    } catch (cause) {
      setError((cause as Error).message.split("\n")[0]);
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, [address, signMessageAsync]);

  const withAuth = useCallback(
    async <T,>(call: (token: string) => Promise<T>): Promise<T> => {
      if (!address) throw new Error("Connect a wallet first.");
      return storeRef.current.withAuth(address, message => signMessageAsync({ message }), call);
    },
    [address, signMessageAsync],
  );

  const value = useMemo<ClobAuthValue>(
    () => ({
      session,
      isSignedIn: Boolean(session),
      isSigningIn,
      error,
      signIn,
      signOut: () => storeRef.current.clear(),
      withAuth,
    }),
    [session, isSigningIn, error, signIn, withAuth],
  );

  return <ClobAuthContext.Provider value={value}>{children}</ClobAuthContext.Provider>;
};

export const useClobAuth = (): ClobAuthValue => {
  const context = useContext(ClobAuthContext);
  if (!context) throw new Error("useClobAuth must be used inside <ClobAuthProvider>");
  return context;
};
