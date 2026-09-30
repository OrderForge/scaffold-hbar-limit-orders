/**
 * Optional parts of the terminal.
 *
 * Each switch here turns a self-contained feature on or off without touching the rest of
 * the app. Flip them by hand, or from the command line:
 *
 *   yarn clob:feature list                 # what exists, and whether it is on
 *   yarn clob:feature off depth-chart      # hide it; the code stays
 *   yarn clob:feature on depth-chart
 *   yarn clob:feature remove depth-chart   # delete its files and every reference to them
 *
 * `remove` is for a project that will never want the feature: it leaves no dead code
 * behind, and the app still type-checks and builds.
 */
const features = {
  // feature:depth-chart
  /** Cumulative bid/ask curve above the order book ladder. */
  depthChart: true,
  // /feature:depth-chart
} as const;

export default features;
