import { expect } from "chai";
import { ethers } from "hardhat";
import { OrderDigest } from "../typechain-types";

/**
 * The EIP-712 order type is written twice — in TypeScript for the client, in Solidity in
 * `OrderDigest.sol` — and this asserts the two agree.
 *
 * It matters because SaucerSwap does not publish the struct. It was read from the deployed
 * reactor's verified source, and a transcription error would not announce itself: the
 * client would still compile, still sign, and produce a signature the reactor rejects for
 * reasons that look like anything but a field order.
 *
 * The order below is the real one the live API returned from `POST /orders/build` on
 * 2026-09-19, and the domain is the one `GET /signature/domain` serves on testnet.
 */

/** Exactly as it must appear in the client. Keep in step with lib/clob/orders.ts. */
const TYPES = {
  PartialFillLimitOrder: [
    { name: "info", type: "OrderInfo" },
    { name: "input", type: "PartialFillInputToken" },
    { name: "output", type: "OutputToken" },
    { name: "makerOnly", type: "bool" },
    { name: "takerOnce", type: "bool" },
    { name: "maxTakerFeePips", type: "uint32" },
    { name: "maxMakerFeePips", type: "uint32" },
  ],
  OrderInfo: [
    { name: "reactor", type: "address" },
    { name: "swapper", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "additionalValidationContract", type: "address" },
    { name: "additionalValidationData", type: "bytes" },
  ],
  PartialFillInputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  OutputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
};

const DOMAIN = {
  name: "PartialFillLimitOrderReactor",
  version: "1",
  chainId: 296,
  verifyingContract: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
};

/** Captured from the live API: order built for account 0.0.10619385 on book 3. */
const ORDER = {
  info: {
    reactor: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
    swapper: "0x610041680b053425c3b0fa76e856d6f534f27418",
    nonce: 1n,
    deadline: 1789832420n,
    additionalValidationContract: "0xd1a45eba17b05cc62b11e2b62b8a00651a79014c",
    additionalValidationData: "0x",
  },
  input: { token: "0x0000000000000000000000000000000000120f46", amount: 10_000_000n },
  output: {
    token: "0x0000000000000000000000000000000000001549",
    amount: 10_000_000n,
    recipient: "0x610041680b053425c3b0fa76e856d6f534f27418",
  },
  makerOnly: true,
  takerOnce: false,
  maxTakerFeePips: 2000,
  maxMakerFeePips: 2000,
};

describe("OrderDigest", () => {
  let digest: OrderDigest;

  before(async () => {
    const factory = await ethers.getContractFactory("OrderDigest");
    digest = (await factory.deploy()) as unknown as OrderDigest;
    await digest.waitForDeployment();
  });

  it("agrees with the client on the type hash", async () => {
    const onChain = await digest.orderTypeHash();
    const offChain = ethers.keccak256(
      ethers.toUtf8Bytes(
        "PartialFillLimitOrder(OrderInfo info,PartialFillInputToken input,OutputToken output,bool makerOnly,bool takerOnce,uint32 maxTakerFeePips,uint32 maxMakerFeePips)" +
          "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)" +
          "OutputToken(address token,uint256 amount,address recipient)" +
          "PartialFillInputToken(address token,uint256 amount)",
      ),
    );
    expect(onChain).to.equal(offChain);
  });

  it("agrees with the client on the struct hash", async () => {
    const onChain = await digest.hashOrder(ORDER);
    const offChain = ethers.TypedDataEncoder.hashStruct("PartialFillLimitOrder", TYPES, ORDER);
    expect(onChain).to.equal(offChain);
  });

  it("agrees with the client on the domain separator", async () => {
    const onChain = await digest.domainSeparator(DOMAIN.name, DOMAIN.version, DOMAIN.chainId, DOMAIN.verifyingContract);
    expect(onChain).to.equal(ethers.TypedDataEncoder.hashDomain(DOMAIN));
  });

  it("agrees on the digest a wallet actually signs", async () => {
    // This is the value that ends up under the signature. If these two ever differ, the
    // client is signing something the reactor will not recognise.
    const onChain = await digest.digest(ORDER, DOMAIN.name, DOMAIN.version, DOMAIN.chainId, DOMAIN.verifyingContract);
    expect(onChain).to.equal(ethers.TypedDataEncoder.hash(DOMAIN, TYPES, ORDER));
  });

  it("notices a field the client got wrong", async () => {
    // The failure this whole file exists to catch: a transcription that looks right.
    const swapped = { ...TYPES, PartialFillLimitOrder: [...TYPES.PartialFillLimitOrder] };
    swapped.PartialFillLimitOrder[3] = { name: "takerOnce", type: "bool" };
    swapped.PartialFillLimitOrder[4] = { name: "makerOnly", type: "bool" };

    const wrong = ethers.TypedDataEncoder.hash(DOMAIN, swapped, {
      ...ORDER,
      makerOnly: ORDER.takerOnce,
      takerOnce: ORDER.makerOnly,
    });
    const right = await digest.digest(ORDER, DOMAIN.name, DOMAIN.version, DOMAIN.chainId, DOMAIN.verifyingContract);
    expect(wrong).to.not.equal(right);
  });

  it("produces a different digest per network, so a testnet signature cannot be replayed on mainnet", async () => {
    const testnet = await digest.digest(ORDER, DOMAIN.name, DOMAIN.version, 296, DOMAIN.verifyingContract);
    const mainnet = await digest.digest(
      ORDER,
      DOMAIN.name,
      DOMAIN.version,
      295,
      "0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C",
    );
    expect(testnet).to.not.equal(mainnet);
  });
});
