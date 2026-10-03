import { describe, expect, it } from "vitest";
import { isReadOnlyByConfig } from "~~/lib/clob/config";

describe("read-only networks for a deployment", () => {
  it("trades everywhere when nothing is set", () => {
    expect(isReadOnlyByConfig("mainnet", undefined)).toBe(false);
    expect(isReadOnlyByConfig("testnet", "")).toBe(false);
  });

  it("only reads the networks listed", () => {
    expect(isReadOnlyByConfig("mainnet", "mainnet")).toBe(true);
    expect(isReadOnlyByConfig("testnet", "mainnet")).toBe(false);
  });

  it("accepts a list, with spaces and any case", () => {
    expect(isReadOnlyByConfig("testnet", "Mainnet, TESTNET")).toBe(true);
    expect(isReadOnlyByConfig("mainnet", "Mainnet, TESTNET")).toBe(true);
  });
});
