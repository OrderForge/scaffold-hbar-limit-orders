export const HBAR_PRICE_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache
/**
 * Fetched through this app's own route, not from CoinGecko directly.
 *
 * CoinGecko does not allow browser requests from arbitrary origins, so calling it from the
 * page logged a CORS failure on every load and never produced a price. The route at
 * `app/api/hbar-price` makes the same request from the server.
 */
export const HBAR_PRICE_URL = "/api/hbar-price";

type HbarPriceCache = {
  price: number;
  timestamp: number;
};

let cache: HbarPriceCache | null = null;

export async function fetchHbarPrice(): Promise<number> {
  const now = Date.now();

  // Return cached price if still valid
  if (cache && now - cache.timestamp < HBAR_PRICE_CACHE_DURATION_MS) {
    return cache.price;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(HBAR_PRICE_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const price = Number(data?.price ?? 0);

    if (price > 0) {
      cache = { price, timestamp: now };
    }

    return price || cache?.price || 0;
  } catch {
    // Silently fail and return cached price or 0
    // This prevents console spam from intermittent network issues
    return cache?.price ?? 0;
  }
}
