/**
 * Contracts this template talks to but does not deploy.
 *
 * Addresses are not guesses: the reactor is the `verifyingContract` returned by
 * `GET /signature/domain`, and Permit2 is what `reactor.permit2()` reports on-chain.
 * `lib/clob/config.ts` holds the same values for the plain client, and `clob:doctor`
 * re-checks both against the live API so a redeployment cannot go unnoticed.
 *
 * Only the functions and events this template uses are listed. The full reactor source is
 * verified on Sourcify.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

const reactorAbi = [
  {
    type: "function",
    name: "permit2",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "cancelOrder",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "signedOrder",
        type: "tuple",
        components: [
          { name: "order", type: "bytes" },
          { name: "sig", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAllBelowNonce",
    stateMutability: "nonpayable",
    inputs: [{ name: "newFloor", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "userNonceFloor",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "TakerFill",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: true },
      { name: "filler", type: "address", indexed: true },
      { name: "swapper", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "principalFilled", type: "uint256", indexed: false },
      { name: "outputAmount", type: "uint256", indexed: false },
      { name: "takerFee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MakerFill",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: true },
      { name: "filler", type: "address", indexed: true },
      { name: "swapper", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "fillAmount", type: "uint256", indexed: false },
      { name: "outputAmount", type: "uint256", indexed: false },
      { name: "makerFee", type: "uint256", indexed: false },
      { name: "rebate", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: true },
      { name: "swapper", type: "address", indexed: true },
    ],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

const externalContracts = {
  296: {
    PartialFillLimitOrderReactor: {
      address: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
      abi: reactorAbi,
    },
    Permit2: {
      address: "0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed",
      abi: permit2Abi,
    },
  },
  295: {
    PartialFillLimitOrderReactor: {
      address: "0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C",
      abi: reactorAbi,
    },
    Permit2: {
      address: "0x8D53a86b10b503f284A0EA9e8316bc6081432A96",
      abi: permit2Abi,
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
