"use client";

import { useAccount } from "wagmi";
import { useClobAuth } from "~~/hooks/clob/useClobAuth";

const expiryLabel = (expiresAt: number): string => {
  const minutes = Math.max(0, Math.round((expiresAt * 1000 - Date.now()) / 60000));
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
};

/**
 * Sign in to the Orderbook API with the connected wallet.
 *
 * Signing the challenge costs nothing and moves nothing: it proves control of the account
 * so the API will return this account's fees, onboarding state and orders.
 */
export const SignInButton = ({ compact = false }: { compact?: boolean }) => {
  const { isConnected } = useAccount();
  const { session, isSignedIn, isSigningIn, error, signIn, signOut } = useClobAuth();

  if (!isConnected) return null;

  if (isSignedIn && session) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="badge badge-success badge-sm">signed in</span>
        {!compact && <span className="opacity-60">{expiryLabel(session.expiresAt)}</span>}
        <button type="button" className="btn btn-ghost btn-xs" onClick={signOut}>
          sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-outline btn-xs" onClick={() => signIn()} disabled={isSigningIn}>
        {isSigningIn ? "check your wallet…" : "Sign in to the API"}
      </button>
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
};
