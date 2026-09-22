/**
 * The money layer. Every value the Orderbook API sends is a decimal **string**, and every
 * one of them is money. Nothing in this file converts through `number`.
 *
 * Internally amounts are bigints in the token's smallest units, plus an explicit decimal
 * exponent. `Number(price) * Number(size)` looks fine in a demo and is wrong by a few
 * tinybars in production, which is the kind of bug that loses real funds.
 */

/**
 * Prices are held at this many decimals, independent of the quote token's own precision.
 *
 * A market's tick can be finer than its quote token: SAUCE/USDC quotes in USDC (6dp) but
 * ticks at 0.0000001 (7dp). Parsing a price at the token's precision silently truncates
 * the last digit, which both loses money and hides off-tick prices from validation.
 */
export const PRICE_SCALE = 18;

/** A decimal held exactly: value = units / 10^decimals. */
export type Decimal = { units: bigint; decimals: number };

const TEN = 10n;

const pow10 = (exponent: number): bigint => TEN ** BigInt(exponent);

/** Parse a decimal string into exact units. Throws on anything that is not a number. */
export const parseDecimal = (value: string, decimals: number): bigint => {
  const trimmed = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === "." || trimmed === "-") {
    throw new Error(`Not a decimal number: ${JSON.stringify(value)}`);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "", fraction = ""] = unsigned.split(".");

  // More precision than the token has is truncated, never rounded: rounding up could
  // create an amount larger than the user agreed to.
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const units = BigInt(whole || "0") * pow10(decimals) + BigInt(padded || "0");
  return negative ? -units : units;
};

export const parseAmount = (value: string, decimals: number): Decimal => ({
  units: parseDecimal(value, decimals),
  decimals,
});

/** Render units as a decimal string. Never produces exponent notation. */
export const formatUnits = (units: bigint, decimals: number, maxFractionDigits?: number): string => {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = pow10(decimals);
  const whole = absolute / divisor;
  let fraction = (absolute % divisor).toString().padStart(decimals, "0");

  if (maxFractionDigits !== undefined && maxFractionDigits < fraction.length) {
    fraction = fraction.slice(0, maxFractionDigits);
  }
  fraction = fraction.replace(/0+$/, "");

  const rendered = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative && (whole !== 0n || fraction) ? `-${rendered}` : rendered;
};

export const formatAmount = (amount: Decimal, maxFractionDigits?: number): string =>
  formatUnits(amount.units, amount.decimals, maxFractionDigits);

/** Group the integer part with thin separators for display only. */
export const formatWithGrouping = (value: string): string => {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
};

/**
 * Fees are in **pips**: 1 pip = 1e-6 = 0.0001%. So 2000 pips = 0.2%.
 * They are not basis points, and reading them as such understates fees 100-fold.
 */
export const pipsToPercent = (pips: number, maxFractionDigits = 4): string => {
  // percent = pips / 10_000, computed on integers.
  const units = BigInt(Math.trunc(pips));
  return formatUnits(units, 4, maxFractionDigits);
};

export const pipsToPercentLabel = (pips: number): string => `${pipsToPercent(pips)}%`;

/** How many decimal places a step string uses, e.g. "0.0000001" → 7. */
export const stepDecimals = (step: string): number => {
  const [, fraction = ""] = step.trim().split(".");
  return fraction.replace(/0+$/, "").length;
};

/** Parse a price at full price precision, never at the quote token's precision. */
export const parsePrice = (price: string): bigint => parseDecimal(price, PRICE_SCALE);

/** Round a price down to the market's tick grid. Returns a decimal string. */
export const roundToTick = (price: string, tickStep: string, decimals: number = PRICE_SCALE): string => {
  const tick = parseDecimal(tickStep, decimals);
  if (tick <= 0n) return price;
  const units = parseDecimal(price, decimals);
  const snapped = (units / tick) * tick;
  return formatUnits(snapped, decimals);
};

/** Round a size down to the market's size step. Returns a decimal string. */
export const roundToSizeStep = (size: string, sizeStep: string, decimals: number): string => {
  const step = parseDecimal(sizeStep, decimals);
  if (step <= 0n) return size;
  const units = parseDecimal(size, decimals);
  const snapped = (units / step) * step;
  return formatUnits(snapped, decimals);
};

/**
 * Round a size down to whole lots.
 *
 * `lotSize` is expressed in the base token's **smallest units** — on testnet SAUCE (6dp)
 * it is "10000000", i.e. 10 SAUCE, which is why every level of the real book is a multiple
 * of 10.
 */
export const roundToLot = (size: string, lotSize: string, decimals: number): string => {
  const lot = BigInt(lotSize.split(".")[0] || "0");
  if (lot <= 0n) return size;
  const units = parseDecimal(size, decimals);
  const snapped = (units / lot) * lot;
  return formatUnits(snapped, decimals);
};

/** Notional = price × size, exact, returned in quote-token units. */
export const notionalUnits = (price: string, size: string, baseDecimals: number, quoteDecimals: number): bigint => {
  const priceUnits = parsePrice(price);
  const sizeUnits = parseDecimal(size, baseDecimals);
  // notional = price x size, expressed in quote units:
  //   priceUnits * sizeUnits / 10^(PRICE_SCALE + baseDecimals - quoteDecimals)
  return (priceUnits * sizeUnits) / pow10(PRICE_SCALE + baseDecimals - quoteDecimals);
};

export const notional = (price: string, size: string, baseDecimals: number, quoteDecimals: number): string =>
  formatUnits(notionalUnits(price, size, baseDecimals, quoteDecimals), quoteDecimals);

/**
 * Render a smallest-units field (minNotional, lotSize) as a token amount.
 *
 * These two arrive as integer strings in the token's smallest units, unlike prices. Showing
 * the raw value tells a reader "15000000" where the truth is "15 USDC".
 */
export const formatSmallestUnits = (value: string, decimals: number): string => {
  try {
    return formatUnits(BigInt(value.split(".")[0] || "0"), decimals);
  } catch {
    return value;
  }
};

export type OrderRule = "tick" | "sizeStep" | "lot" | "minNotional" | "positive" | "market";

export type ValidationResult = { ok: true } | { ok: false; rule: OrderRule; message: string };

export type MarketRules = {
  tickStep: string;
  sizeStep: string;
  lotSize: string;
  minNotional: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  status?: string;
  isMarketHalted?: number;
};

/**
 * Validate an order against the market's own rules **before** asking for a signature.
 *
 * The API enforces all of this too, but only after the user has signed — and a rejected
 * save still burns a nonce and the user's patience. Each failure names the rule it broke.
 */
export const validateOrder = (order: { price: string; size: string }, market: MarketRules): ValidationResult => {
  const { baseTokenDecimals, quoteTokenDecimals } = market;

  let priceUnits: bigint;
  let sizeUnits: bigint;
  try {
    priceUnits = parsePrice(order.price);
    sizeUnits = parseDecimal(order.size, baseTokenDecimals);
  } catch (error) {
    return { ok: false, rule: "positive", message: (error as Error).message };
  }

  if (priceUnits <= 0n) return { ok: false, rule: "positive", message: "Price must be greater than zero." };
  if (sizeUnits <= 0n) return { ok: false, rule: "positive", message: "Size must be greater than zero." };

  if (market.status !== undefined && market.status !== "OPEN") {
    return { ok: false, rule: "market", message: "This market is closed and is not accepting orders." };
  }
  if (market.isMarketHalted === 1) {
    return { ok: false, rule: "market", message: "This market is halted and is not accepting new orders." };
  }

  const tick = parsePrice(market.tickStep);
  if (tick > 0n && priceUnits % tick !== 0n) {
    return {
      ok: false,
      rule: "tick",
      message: `Price must be a multiple of the tick size ${market.tickStep}. Nearest allowed: ${roundToTick(
        order.price,
        market.tickStep,
      )}.`,
    };
  }

  const step = parseDecimal(market.sizeStep, baseTokenDecimals);
  if (step > 0n && sizeUnits % step !== 0n) {
    return {
      ok: false,
      rule: "sizeStep",
      message: `Size must be a multiple of the size step ${market.sizeStep}. Nearest allowed: ${roundToSizeStep(
        order.size,
        market.sizeStep,
        baseTokenDecimals,
      )}.`,
    };
  }

  const lot = BigInt(market.lotSize.split(".")[0] || "0");
  if (lot > 0n && sizeUnits % lot !== 0n) {
    return {
      ok: false,
      rule: "lot",
      message: `Size must be a whole number of lots (${formatUnits(lot, baseTokenDecimals)}). Nearest allowed: ${roundToLot(
        order.size,
        market.lotSize,
        baseTokenDecimals,
      )}.`,
    };
  }

  const value = notionalUnits(order.price, order.size, baseTokenDecimals, quoteTokenDecimals);
  // `minNotional` is in the quote token's smallest units, exactly like `lotSize` — mainnet
  // markets report 15000000 against 6-decimal USDC, meaning 15 USDC. Reading it as a
  // decimal demands 15 million USDC on mainnet, and 1 USDC on testnet where the real
  // minimum is 0.000001.
  const minimum = BigInt(market.minNotional.split(".")[0] || "0");
  if (value < minimum) {
    return {
      ok: false,
      rule: "minNotional",
      message: `Order value ${formatUnits(value, quoteTokenDecimals)} is below this market's minimum of ${formatUnits(
        minimum,
        quoteTokenDecimals,
      )}.`,
    };
  }

  return { ok: true };
};

/** Percentage change rendered for display, with an explicit sign. */
export const formatPercent = (value: string | null | undefined, maxFractionDigits = 2): string => {
  if (value === null || value === undefined || value === "") return "—";
  try {
    const units = parseDecimal(value, 6);
    const rendered = formatUnits(units, 6, maxFractionDigits);
    return units > 0n ? `+${rendered}%` : `${rendered}%`;
  } catch {
    return "—";
  }
};

/** Compare two decimal strings exactly. Returns -1, 0 or 1. */
export const compareDecimalStrings = (a: string, b: string, decimals = 18): -1 | 0 | 1 => {
  const left = parseDecimal(a, decimals);
  const right = parseDecimal(b, decimals);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};
