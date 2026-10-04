# Contributing

Thanks for helping. Issues and pull requests are welcome: bug reports, API changes we have missed,
docs that confused you, and new optional features.

For a security problem, do not open an issue. See [SECURITY.md](SECURITY.md).

## Set up

```bash
git clone https://github.com/OrderForge/scaffold-hbar-limit-orders.git
cd scaffold-hbar-limit-orders
yarn install
yarn next:dev
```

Market data needs no keys. For anything that signs, follow
[Set up the on-chain half](README.md#set-up-the-on-chain-half), on testnet.

## Before you open a pull request

Run what CI runs:

```bash
yarn lint                 # ESLint, Solidity lint and the docs wording check
yarn next:check-types
yarn test:clob            # client tests, offline against recorded fixtures
yarn hardhat:test         # contract tests
yarn next:build
```

A pre-commit hook already lints and type-checks the files you stage. For a larger change, also run
`yarn hedera-harness validate`. Its secret scan fails while a `.env` or `.clob.json` exists, so run it
on a clean checkout.

Every push and pull request also runs the [Hedera Harness](.github/workflows/harness.yaml) and
[CodeQL](.github/workflows/codeql.yaml). Each push to `main` scaffolds the template fresh from GitHub
and boots it ([fresh-scaffold](.github/workflows/fresh-scaffold.yaml)), and the
[API doctor](.github/workflows/doctor.yaml) checks the live API daily.

## The rules that matter most

[AGENTS.md](AGENTS.md) lists them in full. The ones that review will hold you to:

- **Money is `bigint` in smallest units.** Never `Number()` or `parseFloat()` an amount from the API.
- **Key markets on `id`, never on symbol.**
- **Validate before signing.** Anything that asks the wallet to sign checks the market's tick, lot,
  minimum value and halt flag first.
- **The chain is the record.** Onboarding and fills are read back from the mirror node and the
  contracts, not taken from the venue's word.
- **Tokens stay in memory.** No API token in storage, cookies or logs.

## When the API changes

If `yarn clob:doctor` reports a broken assumption, or you find the API behaving differently from its
docs:

1. Add a numbered entry to [docs/DISCREPANCIES.md](docs/DISCREPANCIES.md): what the docs say, what the
   API does, and how the template handles it.
2. Record the real response as a fixture in `packages/nextjs/test/fixtures`, and add a test that fails
   without your fix.
3. If the doctor should catch it next time, add a check to `packages/hardhat/scripts/doctor.ts`.

## Adding an optional feature

Wrap its code in marker comments (`{/* feature:name */}` … `{/* /feature:name */}`), add a switch to
`packages/nextjs/features.config.ts` and an entry to `scripts/feature.mjs`. Then check that
`yarn clob:feature remove name --yes` leaves a project that still type-checks, lints and builds. See
[Optional features](README.md#optional-features).

## Docs

Write plainly, and claim only what the code does. `yarn lint:wording` fails on overstatement and is
part of `yarn lint`. When the UI changes, re-capture the README screenshots with `yarn clob:shots`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`,
`chore:`. Keep each commit about one thing, and say why in the body when it is not obvious.

## Licence

By contributing, you agree that your contribution is licensed under the [MIT licence](LICENSE).
