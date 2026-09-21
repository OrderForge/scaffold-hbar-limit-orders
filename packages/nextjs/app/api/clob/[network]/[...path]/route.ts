import { NextRequest, NextResponse } from "next/server";
import { CLOB_NETWORKS, ClobNetwork } from "~~/lib/clob/config";

/**
 * Same-origin proxy for the SaucerSwap V3 Orderbook API.
 *
 * The API sends no `Access-Control-Allow-Origin` header, so a browser cannot call it
 * directly however public the endpoint is — it is built for server-side clients. Rather
 * than dropping browser support, the app forwards requests through its own origin.
 *
 * This proxy holds no secrets and adds no credentials of its own. An `Authorization`
 * header supplied by the caller is forwarded untouched and never logged, so the JWT still
 * only ever lives in the browser's memory and in the upstream request.
 */

const ALLOWED_PREFIXES = ["books", "depth", "trades", "signature", "fees", "onboarding", "orders", "cancel", "auth"];

const isAllowed = (segments: string[]) => segments.length > 0 && ALLOWED_PREFIXES.includes(segments[0]);

const resolveNetwork = (value: string): ClobNetwork | null =>
  value === "testnet" || value === "mainnet" ? value : null;

const forward = async (request: NextRequest, context: { params: Promise<{ network: string; path: string[] }> }) => {
  const { network: networkParam, path } = await context.params;

  const network = resolveNetwork(networkParam);
  if (!network) {
    return NextResponse.json({ error: `Unknown network: ${networkParam}` }, { status: 400 });
  }
  if (!isAllowed(path)) {
    return NextResponse.json({ error: `Path not permitted: /${path.join("/")}` }, { status: 403 });
  }

  const upstream = new URL(`${CLOB_NETWORKS[network].apiUrl}/${path.map(encodeURIComponent).join("/")}`);
  upstream.search = request.nextUrl.search;

  const authorization = request.headers.get("authorization");
  const body = request.method === "POST" ? await request.text() : undefined;

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(authorization ? { authorization } : {}),
      },
      body,
      // The client layer does its own caching; this hop should stay transparent.
      cache: "no-store",
    });

    // Pass the upstream status and body through untouched so the client's typed errors
    // (401 on a public read, the HTML 404 page, 429) still mean what they mean.
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        ...(response.headers.get("retry-after") ? { "retry-after": response.headers.get("retry-after")! } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Could not reach the ${network} Orderbook API: ${(error as Error).message}` },
      { status: 502 },
    );
  }
};

export const GET = forward;
export const POST = forward;
