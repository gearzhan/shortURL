# Agents

The short URL worker can be managed by a small set of operational "agents" - human or automated roles that keep the service healthy. Use this guide to understand their scope and hand-offs.

## 1. Runtime Agent
- Owns deployment to Cloudflare Workers through Wrangler.
- Verifies environment bindings (KV namespaces, secrets) before each deploy.
- Monitors worker logs and error rates; escalates incidents.

## 2. Data Steward Agent
- Manages the `URLS` KV namespace lifecycle.
- Reviews requests for manual URL cleanup or recovery.
- Audits access controls and retention policies.

## 3. Product Support Agent
- Handles user-reported issues via the REST API or web UI.
- Confirms redirect analytics accuracy and communicates status.
- Coordinates with Runtime and Data Steward agents on fixes.

## 4. Quality Agent
- Runs `npm test` and other validation workflows.
- Tracks flaky tests or regressions and files actionable tickets.
- Signs off on release readiness ahead of production deploys.

## Quick Start Checklist
1. Install dependencies: `npm install`.
2. Generate KV namespaces with Wrangler and update `wrangler.jsonc`.
3. Run `npm run dev` for local testing; `npm run deploy` when ready.

Document updates: keep this file current as new roles or automation emerge.


