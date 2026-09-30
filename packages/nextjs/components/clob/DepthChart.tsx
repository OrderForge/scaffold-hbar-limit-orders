"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NormalizedDepth } from "~~/lib/clob/depth";
import { DEFAULT_CHART_LEVELS, buildDepthCurve, depthAtPrice, stepPath } from "~~/lib/clob/depthChart";
import { Orderbook } from "~~/lib/clob/types";

type DepthChartProps = {
  depth: NormalizedDepth;
  market: Orderbook;
  /** Levels per side to draw. More shows further from the touch, at the cost of detail near it. */
  levels?: number;
  /** Chart height in pixels. The width follows the container. */
  height?: number;
  className?: string;
};

const PAD = { top: 10, right: 8, bottom: 20, left: 8 };

// Theme colours rather than fixed ones, so the chart follows light and dark mode.
const SIDE_STYLE = {
  bid: { stroke: "var(--color-success)", fill: "color-mix(in oklab, var(--color-success) 16%, transparent)" },
  ask: { stroke: "var(--color-error)", fill: "color-mix(in oklab, var(--color-error) 16%, transparent)" },
} as const;

const formatPrice = (value: number) => String(Number(value.toPrecision(5)));
const formatSize = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/**
 * Cumulative depth: how much you could buy or sell before the price reaches a level.
 *
 * It is drawn from the same depth the ladder shows, so it moves with the stream. The curve
 * is for reading the book at a glance; the ladder beside it stays the exact record.
 *
 * Optional: switch it off with `yarn clob:feature off depth-chart`, or delete it with
 * `yarn clob:feature remove depth-chart`.
 */
export const DepthChart = ({
  depth,
  market,
  levels = DEFAULT_CHART_LEVELS,
  height = 170,
  className = "",
}: DepthChartProps) => {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const curve = useMemo(() => buildDepthCurve(depth, { levels }), [depth, levels]);
  const base = market.baseTokenSymbol ?? "base";

  const innerWidth = Math.max(0, width - PAD.left - PAD.right);
  const innerHeight = height - PAD.top - PAD.bottom;
  const span = curve.maxPrice - curve.minPrice || 1;

  const x = (price: number) => {
    if (price === -Infinity) return PAD.left;
    if (price === Infinity) return PAD.left + innerWidth;
    return PAD.left + ((price - curve.minPrice) / span) * innerWidth;
  };
  const y = (cumulative: number) =>
    PAD.top + innerHeight - (curve.maxCumulative > 0 ? (cumulative / curve.maxCumulative) * innerHeight : 0);

  const hover =
    hoverX === null ? null : depthAtPrice(curve, curve.minPrice + ((hoverX - PAD.left) / innerWidth) * span);

  if (curve.isEmpty) {
    return (
      <div className={`flex items-center justify-center text-xs opacity-50 ${className}`} style={{ height }}>
        No depth to chart.
      </div>
    );
  }

  return (
    <div ref={container} className={`relative select-none ${className}`} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Depth chart for ${market.baseTokenSymbol}/${market.quoteTokenSymbol}: ${formatSize(
            curve.bids.at(-1)?.cumulative ?? 0,
          )} ${base} bid and ${formatSize(curve.asks.at(-1)?.cumulative ?? 0)} ${base} offered within ${levels} levels.`}
          onMouseMove={event => setHoverX(event.clientX - event.currentTarget.getBoundingClientRect().left)}
          onMouseLeave={() => setHoverX(null)}
        >
          {(["bid", "ask"] as const).map(side => {
            const points = side === "bid" ? curve.bids : curve.asks;
            return (
              <g key={side}>
                <path d={stepPath(points, side, x, y, "area")} style={{ fill: SIDE_STYLE[side].fill }} />
                <path
                  d={stepPath(points, side, x, y, "line")}
                  style={{ fill: "none", stroke: SIDE_STYLE[side].stroke, strokeWidth: 1.5 }}
                />
              </g>
            );
          })}

          {curve.mid !== null && (
            <line
              x1={x(curve.mid)}
              x2={x(curve.mid)}
              y1={PAD.top}
              y2={PAD.top + innerHeight}
              className="stroke-current opacity-25"
              strokeDasharray="3 3"
            />
          )}

          <line
            x1={PAD.left}
            x2={PAD.left + innerWidth}
            y1={PAD.top + innerHeight}
            y2={PAD.top + innerHeight}
            className="stroke-current opacity-15"
          />

          {/* A halo in the page colour keeps labels legible where they cross a curve. */}
          <g
            className="fill-current text-[10px] opacity-70"
            style={{
              fontFamily: "ui-monospace, monospace",
              paintOrder: "stroke",
              stroke: "var(--color-base-100)",
              strokeWidth: 3,
              strokeLinejoin: "round",
            }}
          >
            <text x={PAD.left} y={height - 5}>
              {formatPrice(curve.minPrice)}
            </text>
            {curve.mid !== null && (
              <text x={x(curve.mid)} y={height - 5} textAnchor="middle">
                {formatPrice(curve.mid)}
              </text>
            )}
            <text x={PAD.left + innerWidth} y={height - 5} textAnchor="end">
              {formatPrice(curve.maxPrice)}
            </text>
            <text x={PAD.left + 2} y={PAD.top + 9}>
              {formatSize(curve.maxCumulative)} {base}
            </text>
          </g>

          {hover && hoverX !== null && (
            <g pointerEvents="none">
              <line
                x1={hoverX}
                x2={hoverX}
                y1={PAD.top}
                y2={PAD.top + innerHeight}
                className="stroke-current opacity-40"
              />
              <circle cx={hoverX} cy={y(hover.cumulative)} r={3.5} style={{ fill: SIDE_STYLE[hover.side].stroke }} />
            </g>
          )}
        </svg>
      )}

      {hover && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-box bg-base-200 px-2 py-1 font-mono text-[11px] shadow"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          {hover.side === "bid" ? "Bids down to" : "Asks up to"} {formatPrice(hover.price)}
          <span className="opacity-60"> · </span>
          {formatSize(hover.cumulative)} {base}
        </div>
      )}
    </div>
  );
};
