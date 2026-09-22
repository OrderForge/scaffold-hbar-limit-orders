// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OrderDigest
 * @notice Computes the EIP-712 digest of a SaucerSwap V3 limit order, in Solidity.
 *
 * @dev This exists to be disagreed with.
 *
 * SaucerSwap does not publish the order struct. It was read from the deployed reactor's
 * verified source, transcribed into TypeScript in `lib/clob/orders.ts`, and the live API
 * accepted an order signed from it. That is good evidence, but a transcription can drift:
 * rename a field, reorder two members, change a `uint32` to a `uint256`, and the client
 * still compiles, still signs, and produces a signature the reactor will silently reject.
 *
 * So the type is written out twice — once in TypeScript, once here — and a test asserts the
 * two produce the same digest for the same order. If someone edits one and not the other,
 * the test fails with the exact hash that changed.
 *
 * Written from the published type strings rather than copied: the reactor's own source is
 * GPL, and this template is MIT.
 */
contract OrderDigest {
    /// @dev EIP-712 requires referenced struct types sorted alphabetically after the primary type.
    string internal constant ORDER_TYPE =
        "PartialFillLimitOrder(OrderInfo info,PartialFillInputToken input,OutputToken output,bool makerOnly,bool takerOnce,uint32 maxTakerFeePips,uint32 maxMakerFeePips)"
        "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)"
        "OutputToken(address token,uint256 amount,address recipient)"
        "PartialFillInputToken(address token,uint256 amount)";

    string internal constant ORDER_INFO_TYPE =
        "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)";

    string internal constant INPUT_TOKEN_TYPE = "PartialFillInputToken(address token,uint256 amount)";

    string internal constant OUTPUT_TOKEN_TYPE = "OutputToken(address token,uint256 amount,address recipient)";

    string internal constant DOMAIN_TYPE =
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

    struct OrderInfo {
        address reactor;
        address swapper;
        uint256 nonce;
        uint256 deadline;
        address additionalValidationContract;
        bytes additionalValidationData;
    }

    struct InputToken {
        address token;
        uint256 amount;
    }

    struct OutputToken {
        address token;
        uint256 amount;
        address recipient;
    }

    struct Order {
        OrderInfo info;
        InputToken input;
        OutputToken output;
        bool makerOnly;
        bool takerOnce;
        uint32 maxTakerFeePips;
        uint32 maxMakerFeePips;
    }

    function orderTypeHash() public pure returns (bytes32) {
        return keccak256(bytes(ORDER_TYPE));
    }

    function hashInfo(OrderInfo memory info) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(bytes(ORDER_INFO_TYPE)),
                    info.reactor,
                    info.swapper,
                    info.nonce,
                    info.deadline,
                    info.additionalValidationContract,
                    // Dynamic types are hashed, not inlined.
                    keccak256(info.additionalValidationData)
                )
            );
    }

    function hashInput(InputToken memory input) public pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(bytes(INPUT_TOKEN_TYPE)), input.token, input.amount));
    }

    function hashOutput(OutputToken memory output) public pure returns (bytes32) {
        return
            keccak256(abi.encode(keccak256(bytes(OUTPUT_TOKEN_TYPE)), output.token, output.amount, output.recipient));
    }

    /// @notice The struct hash of an order, before the domain is mixed in.
    function hashOrder(Order memory order) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    orderTypeHash(),
                    hashInfo(order.info),
                    hashInput(order.input),
                    hashOutput(order.output),
                    order.makerOnly,
                    order.takerOnce,
                    order.maxTakerFeePips,
                    order.maxMakerFeePips
                )
            );
    }

    /// @notice The domain separator for a given environment, as `GET /signature/domain` describes it.
    function domainSeparator(
        string memory name,
        string memory version,
        uint256 chainId,
        address verifyingContract
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(bytes(DOMAIN_TYPE)),
                    keccak256(bytes(name)),
                    keccak256(bytes(version)),
                    chainId,
                    verifyingContract
                )
            );
    }

    /// @notice The digest a wallet actually signs: `0x1901 ‖ domainSeparator ‖ structHash`.
    function digest(
        Order memory order,
        string memory name,
        string memory version,
        uint256 chainId,
        address verifyingContract
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    domainSeparator(name, version, chainId, verifyingContract),
                    hashOrder(order)
                )
            );
    }
}
