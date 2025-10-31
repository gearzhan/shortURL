# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` holds the Cloudflare Worker with routing, KV helpers, analytics, and guard rails.
- `test/index.spec.ts` runs in Vitest’s Workers pool; shared types sit in `test/env.d.ts`.
- Operational settings live in `wrangler.jsonc`, `tsconfig.json`, and `worker-configuration.d.ts`; keep `.wrangler/` local-only.

## Build, Test, and Development Commands
- `npm install` brings in Wrangler, Vitest, and TypeScript dependencies.
- `npm run dev` starts a local worker tunnel; `npm run deploy` publishes to Workers using `wrangler.jsonc`.
- `npm test` executes Vitest; append `--runInBand` for flaky suites.
- `npm run cf-typegen` regenerates `worker-configuration.d.ts` after binding edits.

## Coding Style & Naming Conventions
- TypeScript with 2-space indentation, single-quoted strings, and minimal trailing commas.
- Use descriptive camelCase for symbols; reserve SCREAMING_CASE for environment bindings.
- Keep handlers pure when possible and funnel I/O through `env.URLS`.

## Testing Guidelines
- Vitest with `@cloudflare/vitest-pool-workers` powers `test/*.spec.ts`.
- Name suites after the behavior under test (`describe('redirect analytics', ...)`) and include auth edge cases.
- Chase >90% coverage on redirect paths and run `npm test -- --coverage` before release sign-off.

## Commit & Pull Request Guidelines
- Write imperative commit subjects (`Add lock-aware pruning`) ≤72 characters and reference issues (`#123`) when relevant.
- PRs must outline user impact, document test evidence, and include UI screenshots; tag needed agent reviewers.

## Agent Responsibilities
- Runtime Agent safeguards Wrangler deploys, validates bindings, and monitors `wrangler tail` after releases.
- Data Steward Agent manages the `URLS` namespace lifecycle, approves cleanup, and audits retention.
- Product Support Agent triages API/UI reports, double-checks analytics, and coordinates cross-agent fixes.
- Quality Agent runs `npm test`, tracks flakiness, and withholds release sign-off without regression proof.

## Security & Configuration Tips
- Store secrets with `wrangler secret put`; never commit them.
- Keep KV namespaces aligned across environments and log changes here.
- Review Cloudflare access quarterly and revoke stale tokens promptly.
