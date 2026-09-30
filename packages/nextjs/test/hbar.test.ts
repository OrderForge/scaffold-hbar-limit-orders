import { decodeFunctionData, encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { IHRC632_ABI, hbarApproveCall, isNativeHbar } from "~~/lib/hedera/hbar";

const OWNER = "0x610041680B053425c3b0fa76E856d6F534F27418" as const;
const PERMIT2 = "0x8D53a86b10b503f284A0EA9e8316bc6081432A96" as const;

describe("recognising native HBAR", () => {
  it("accepts both of the API's names for it", () => {
    expect(isNativeHbar("0.0.0")).toBe(true);
    expect(isNativeHbar("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("does not mistake a token for it", () => {
    expect(isNativeHbar("0.0.456858")).toBe(false);
    expect(isNativeHbar("0x000000000000000000000000000000000006f89a")).toBe(false);
    expect(isNativeHbar(undefined)).toBe(false);
  });
});

describe("granting an HBAR allowance (HIP-906)", () => {
  const call = hbarApproveCall(OWNER, PERMIT2, 100_000_000n);

  it("is sent to the owner's own address, which Hedera redirects to the Account Service", () => {
    // The long-zero form of the same account is not redirected: a call there returns nothing.
    expect(call.address).toBe(OWNER);
  });

  it("uses the selector HIP-906 specifies", () => {
    const data = encodeFunctionData({ abi: IHRC632_ABI, functionName: call.functionName, args: call.args });
    expect(data.slice(0, 10)).toBe("0x86aff07c");
  });

  it("names Permit2 as the spender and the amount in tinybars", () => {
    const data = encodeFunctionData({ abi: IHRC632_ABI, functionName: call.functionName, args: call.args });
    const decoded = decodeFunctionData({ abi: IHRC632_ABI, data });
    expect(decoded.args).toEqual([PERMIT2, 100_000_000n]);
  });
});
