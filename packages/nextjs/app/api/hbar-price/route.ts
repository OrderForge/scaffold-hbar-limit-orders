import { NextResponse } from "next/server";

/**
 * HBAR price in USD, fetched server-side.
 *
 * CoinGecko does not allow browser requests from arbitrary origins, so fetching it directly
 * from the page logs a CORS failure on every load and never returns a price. Same class of
 * problem as the Orderbook API, same fix: make the request from the server.
 *
 * The price is decoration — it renders a USD figure next to a balance — so a failure here
 * returns 0 rather than an error. Nothing on the trading path depends on it.
 */

const UPSTREAM = "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd";

export const revalidate = 300;

export async function GET() {
  try {
    const response = await fetch(UPSTREAM, {
      headers: { accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return NextResponse.json({ price: 0 });

    const body = await response.json();
    const price = Number(body?.["hedera-hashgraph"]?.usd ?? 0);
    return NextResponse.json({ price: Number.isFinite(price) ? price : 0 });
  } catch {
    return NextResponse.json({ price: 0 });
  }
}
