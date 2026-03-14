# Boxbox - F1 Assistant

Boxbox is an F1 chat assistant on Cloudflare. It refines vague user questions, classifies intent, fetches Jolpica API data, and generates grounded responses with Llama 3.3 on Workers AI.

## Live Demo

[https://boxbox.jisnugm.com](https://boxbox.jisnugm.com)

> Built as the optional assignment for the Cloudflare internship application. Due to finals, I didn't get to tailor it further — but it's fully functional and I'm happy with where it landed.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS v4 |
| Worker | Cloudflare Worker (TypeScript) |
| AI | Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| Memory | Durable Objects (`SessionMemory`) |
| Data | Jolpica F1 API |

## Architecture

### Request Flow
1. Frontend sends `POST /chat` with `{ message, sessionId, timezone }`.
2. Worker validates and normalizes input (trim, empty checks, session/timezone validation).
3. Worker loads session history from Durable Object.
4. Worker checks canned intents first (`capabilities`, `live_telemetry`) to avoid unnecessary LLM calls.
5. If not canned, worker refines the query and classifies intent.
6. Worker fetches intent-specific Jolpica data.
7. Worker enriches race schedule data with deterministic `timeContext` (user-local and circuit-local formatted times).
8. Worker calls the main LLM prompt with `[F1 DATA]` + history + refined query.
9. Worker appends messages to Durable Object memory (capped at 20).
10. Worker returns:
   - `response` (required)
   - `refinedQuery` (optional)
   - `meta` (optional, non-breaking): `{ intent, dataStatus }`

### Worker Modules
```
worker/src/
  index.ts              # Worker entry
  chat-handler.ts       # /chat orchestration, CORS, logging
  durable.ts            # SessionMemory Durable Object
  durable-validation.ts # Durable payload validation + history caps
  validation.ts         # Request validation + season/round extractors
  timezone.ts           # Circuit timezone resolution + race time enrichment
  jolpica.ts            # API fetchers + race name matching
  intent.ts             # Canned + keyword + LLM intent classification
  prompts.ts            # Refinement/system/classification prompts
```

### Observability
Worker logs include `requestId` and phase markers:
- `chat_request`
- `intent_resolved`
- `data_fetch`

## Local Development

### Prerequisites
- Node.js 18+
- Cloudflare account and Wrangler auth

### Worker
```bash
cd worker
npm install
npx wrangler dev
```
Worker runs at `http://localhost:8787`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at `http://localhost:5173` and proxies `/chat` to `http://localhost:8787`.

## Verification

### Frontend checks
```bash
cd frontend
npm run lint
npm run build
```

### Worker checks
```bash
cd worker
npm run typecheck
npm test
```

`npm test` covers:
- request validation
- durable payload validation
- intent routing
- race name matching
- `/chat` integration scenarios (happy path, canned intent bypass, blank message, Jolpica failure)

## Deploy

### Worker
```bash
cd worker
npx wrangler deploy
```

### Frontend (Cloudflare Pages)
Use:
- Framework: Vite
- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`

If frontend and worker are on different domains, set `VITE_WORKER_URL` (supports base URL or direct `/chat` URL).

## Example Queries
- `last race`
- `who won round 5 in 2025?`
- `show all standings`
- `what can you do?`
- `when is the next sprint?`
- `show me the 2026 race calendar`

## Out of Scope
- Live telemetry implementation (placeholder intent only)
- Authentication
- Cross-device persistent user accounts
