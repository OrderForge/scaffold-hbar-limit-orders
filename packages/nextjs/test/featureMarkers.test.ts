import { FEATURES, stripFeature } from "../../../scripts/feature.mjs";
import { describe, expect, it } from "vitest";

/**
 * `yarn clob:feature remove` edits source files, so its rules are tested here against
 * strings rather than trusted against the tree: a marker it misses leaves dead code, and
 * a marker it over-matches deletes code that belongs to something else.
 */
describe("removing a feature's marked code", () => {
  it("removes a JSX block and the lines it sits on", () => {
    const page = [
      "<div>",
      "  <Header />",
      "  {/* feature:depth-chart */}",
      "  {features.depthChart && <DepthChart />}",
      "  {/* /feature:depth-chart */}",
      "  <Ladder />",
      "</div>",
      "",
    ].join("\n");

    expect(stripFeature(page, "depth-chart")).toBe(["<div>", "  <Header />", "  <Ladder />", "</div>", ""].join("\n"));
  });

  it("removes a line-comment block, as used in the config", () => {
    const config = [
      "const features = {",
      "  // feature:depth-chart",
      "  /** Cumulative bid/ask curve. */",
      "  depthChart: true,",
      "  // /feature:depth-chart",
      "} as const;",
      "",
    ].join("\n");

    expect(stripFeature(config, "depth-chart")).toBe(["const features = {", "} as const;", ""].join("\n"));
  });

  it("removes a single marked import", () => {
    const source = [
      'import { DepthChart } from "~~/components/clob/DepthChart"; // feature:depth-chart',
      'import { DepthLadder } from "~~/components/clob/DepthLadder";',
      "",
    ].join("\n");

    expect(stripFeature(source, "depth-chart")).toBe('import { DepthLadder } from "~~/components/clob/DepthLadder";\n');
  });

  it("drops the shared features import once nothing reads it", () => {
    const source = [
      'import features from "~~/features.config";',
      "{/* feature:depth-chart */}",
      "{features.depthChart && <DepthChart />}",
      "{/* /feature:depth-chart */}",
      "<Ladder />",
      "",
    ].join("\n");

    expect(stripFeature(source, "depth-chart")).toBe("<Ladder />\n");
  });

  it("keeps the shared import while another feature still reads it", () => {
    const source = [
      'import features from "~~/features.config";',
      "{/* feature:depth-chart */}",
      "{features.depthChart && <DepthChart />}",
      "{/* /feature:depth-chart */}",
      "{features.somethingElse && <Other />}",
      "",
    ].join("\n");

    expect(stripFeature(source, "depth-chart")).toContain('import features from "~~/features.config";');
  });

  it("leaves other features' markers alone", () => {
    const source = ["{/* feature:other */}", "<Other />", "{/* /feature:other */}", ""].join("\n");
    expect(stripFeature(source, "depth-chart")).toBe(source);
  });

  it("knows the depth chart's files", () => {
    expect(FEATURES["depth-chart"].files).toContain("components/clob/DepthChart.tsx");
  });
});
