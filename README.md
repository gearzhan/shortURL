# shortURL - Cloudflare Workers URL Shortener

A production-focused URL shortener built on Cloudflare Workers and KV storage. It provides a password-protected dashboard, REST API, and lightweight analytics for redirect usage.

## Features
- Shorten URLs with optional human-readable descriptions
- Track redirect counts and last access times directly in KV
- Optional 30-day expiration per link; permanent links remain until removed
- Search previously created links by description and browse recent activity
- Lock critical records and run manual or bulk clean-up on stale entries without risking mistakes
- CORS-enabled REST API plus a responsive web UI for internal operators

## Architecture
- **Worker**: Handles the HTTP surface area (API, UI pages, redirects)
- **KV Namespace (`URLS`)**: Stores the canonical short URL records
- **Wrangler**: Builds, runs, and deploys the worker alongside its KV bindings

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Generate KV namespaces (production + preview) if you have not already:
   ```bash
   npx wrangler kv:namespace create "URLS"
   npx wrangler kv:namespace create "URLS" --preview
   ```
3. Start local development in a Miniflare-like environment:
   ```bash
   npm run dev
   ```

## Testing
Run the Vitest suite (includes the Cloudflare test harness):
```bash
npm test
```

## Deployment
Deploy to Cloudflare Workers (runs pending migrations automatically):
```bash
npm run deploy
```

## REST API Reference
- **POST `/api/urls`** - Create a new short URL. Body supports `url`, optional `description`, and optional `expirationType` ("permanent" or "30days").
- **GET `/api/urls`** - List recent URLs. Accepts `limit` (defaults to 50, capped at 1000) and `cursor` for pagination.
- **GET `/api/urls/search?q=term`** - Case-insensitive description search. Returns `scanLimitHit` when the server stops scanning additional records.
- **GET `/api/urls/stats?code=abc123`** - Retrieve redirect metrics, creation time, lock state, and expiration metadata for a specific code.
- **POST `/api/urls/lock`** - Toggle a record's lock state by sending `{ "code": "abc123", "locked": true | false }`.
- **DELETE `/api/urls?code=abc123`** - Permanently delete a single unlocked short URL. Returns `423 Locked` if the record is protected.
- **POST `/api/urls/bulk-delete`** - Delete multiple records by supplying a `codes` array or an `olderThanDays` value (defaults to 120). Locked records are skipped automatically.
- **GET `/{shortCode}`** - Redirect to the original URL, or return `410 Gone` if the link is expired.

## Operational Notes
- Redirect counters update in KV on each redirect; note that increments are eventually consistent under heavy concurrency.
- Expired links are filtered from API responses and deleted on demand when a redirect is attempted.
- Locked records are skipped by deletion endpoints and UI actions until you explicitly unlock them.
- The history UI targets records older than 120 days for quick clean-up; adjust the retention window with the `bulk-delete` endpoint when needed.

## Contributing
- Keep TypeScript changes ASCII-only unless Unicode is required for user-visible text.
- Run `npm test` before submitting patches to ensure the worker logic still passes the harness.
- Update `agents.md` whenever operational responsibilities change.
