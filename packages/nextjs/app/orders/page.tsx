"use client";

import { useState } from "react";
import Link from "next/link";
import { FillChecks } from "~~/components/clob/FillChecks";
import { SignInButton } from "~~/components/clob/SignInButton";
import { WalletGate } from "~~/components/clob/WalletGate";
import { useOrderHistory, useOrders } from "~~/hooks/clob/useAccountData";
import { useClobAuth } from "~~/hooks/clob/useClobAuth";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useBooks } from "~~/hooks/clob/useMarketData";
import { useCancelOrder } from "~~/hooks/clob/usePlaceOrder";
import { AccountOrder, isOpenOrder, normalizeEventType } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

const statusClass = (status: string) => {
  const value = status.toUpperCase();
  if (value === "FILLED") return "badge-success";
  if (value === "CANCELED" || value === "CANCELLED") return "badge-ghost";
  if (value === "ACTIVE" || value === "OPEN") return "badge-info";
  return "badge-outline";
};

const HistoryDrawer = ({ order, onClose }: { order: AccountOrder; onClose: () => void }) => {
  const orderId = order.id;
  const { data: history, isLoading, error } = useOrderHistory(orderId);
  const { data: books } = useBooks();
  // Resolve the market by id from the history response. Matching on the pair label would
  // be wrong: several markets share a display symbol.
  const market = history?.orderbookId ? books?.find(book => book.id === history.orderbookId) : undefined;
  const { config } = useClobNetwork();
  const links = hashscan(config);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-base-100 p-6"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Order {orderId}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            close
          </button>
        </div>

        {isLoading && <p className="mt-6 text-sm opacity-60">Loading history…</p>}
        {error && <p className="mt-6 text-sm text-error">{(error as Error).message}</p>}

        {history && (
          <ul className="mt-6 space-y-3">
            {history.events.map(event => (
              <li key={event.id} className="border-l-2 border-base-300 pl-3">
                <p className="text-sm font-medium">{normalizeEventType(event.type)}</p>
                <p className="font-mono text-xs opacity-60">{new Date(event.timestamp).toLocaleString()}</p>
                {event.reason && <p className="text-xs opacity-70">reason: {event.reason}</p>}
                {event.txHash && (
                  <a className="link text-xs" href={links.transaction(event.txHash)} target="_blank" rel="noreferrer">
                    settlement transaction
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        {market && history && <FillChecks order={order} market={market} events={history.events} />}

        <p className="mt-6 text-xs opacity-60">
          Event names differ by surface: the live stream says <code className="font-mono">ORDER_CANCELED</code> where
          this history says <code className="font-mono">CANCELED</code>. The template normalises both.
        </p>
      </div>
    </div>
  );
};

const CancelButton = ({ orderId }: { orderId: string }) => {
  const { cancel, stage, error } = useCancelOrder();

  if (stage === "confirmed") return <span className="text-xs opacity-60">cancelled</span>;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        disabled={stage === "requesting" || stage === "requested"}
        onClick={() => cancel(orderId)}
      >
        {/* A 202 means accepted, not cancelled: say so until the history confirms it. */}
        {stage === "requesting" ? "cancelling…" : stage === "requested" ? "cancel requested" : "cancel"}
      </button>
      {error && (
        <span className="text-xs text-error" title={error}>
          !
        </span>
      )}
    </span>
  );
};

const OrderRow = ({ order, onOpen }: { order: AccountOrder; onOpen: (order: AccountOrder) => void }) => (
  <tr className="hover">
    <td className="font-mono text-xs">{order.id}</td>
    <td className="text-xs">{order.pair ?? "—"}</td>
    <td className={`text-xs ${order.direction === "buy" ? "text-success" : "text-error"}`}>
      {order.direction?.toUpperCase() ?? "—"}
    </td>
    <td className="text-right font-mono text-xs">{order.price ?? "—"}</td>
    <td className="text-right font-mono text-xs">{order.amount ?? "—"}</td>
    <td className="text-right font-mono text-xs">{order.percentFilled ?? "0.00"}%</td>
    <td>
      <span className={`badge badge-sm ${statusClass(order.status)}`}>{order.status}</span>
    </td>
    <td className="text-right">
      {isOpenOrder(order) && <CancelButton orderId={order.id} />}
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => onOpen(order)}>
        history
      </button>
    </td>
  </tr>
);

const OrdersPage = () => {
  const { isSignedIn } = useClobAuth();
  const { data: orders, isLoading, error } = useOrders();
  const [openOrder, setOpenOrder] = useState<AccountOrder | null>(null);

  const open = orders?.filter(isOpenOrder) ?? [];
  const past = orders?.filter(order => !isOpenOrder(order)) ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Your orders</h1>
          <p className="mt-1 text-sm opacity-70">
            Orders for the connected account, read from SaucerSwap with a short-lived token held in memory only.
          </p>
        </div>
        <SignInButton />
      </div>

      {!isSignedIn && (
        <div className="mt-12 rounded-box bg-base-200 p-8">
          <WalletGate needsSignIn action="see your orders">
            <span />
          </WalletGate>
        </div>
      )}

      {error && <div className="alert alert-error mt-6">{(error as Error).message}</div>}
      {isSignedIn && isLoading && !error && <p className="mt-12 text-center opacity-60">Loading orders…</p>}

      {isSignedIn && orders && orders.length === 0 && (
        <div className="mt-12 rounded-box bg-base-200 p-8 text-center text-sm opacity-70">
          <p>No orders yet.</p>
          <p className="mt-1">
            Place one from a{" "}
            <Link href="/markets" className="link">
              market page
            </Link>
            . Orders you place appear here with their status and history, and every fill is checked against the order
            you signed.
          </p>
        </div>
      )}

      {isSignedIn && orders && orders.length > 0 && (
        <div className="mt-6 space-y-8">
          {[
            { title: "Open", rows: open },
            { title: "Past", rows: past },
          ]
            .filter(section => section.rows.length > 0)
            .map(section => (
              <div key={section.title}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-70">
                  {section.title} ({section.rows.length})
                </h2>
                <div className="overflow-x-auto rounded-box bg-base-100">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Id</th>
                        <th>Market</th>
                        <th>Side</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Size</th>
                        <th className="text-right">Filled</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map(order => (
                        <OrderRow key={order.id} order={order} onOpen={setOpenOrder} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
        </div>
      )}

      {openOrder && <HistoryDrawer order={openOrder} onClose={() => setOpenOrder(null)} />}
    </div>
  );
};

export default OrdersPage;
