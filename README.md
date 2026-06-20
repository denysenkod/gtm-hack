# B2G Tender Discovery Prototype

TypeScript prototype for matching a business profile against public procurement notices from the UK Find a Tender OCDS release package API.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The dev script starts:

- Express API on `http://127.0.0.1:8787`
- Vite frontend on `http://127.0.0.1:5173`

## Search API

```http
POST /api/search
Content-Type: application/json

{
  "businessSpecification": "We deliver secure cloud software, workflow automation, CRM integration, data migration, analytics dashboards, and public sector support."
}
```

The backend queries Find a Tender OCDS releases, normalizes candidate records into the shared `Tender` interface, returns the visible tender list immediately, then embeds the business profile and tender text with local Hugging Face Transformers in background batches. Vectors are stored in `.data/vector-store.json`, and active tenders are progressively ranked by cosine similarity as embeddings become ready. If the upstream source rate-limits, times out, or is unavailable, the server returns realistic mock OCDS data with a warning.

Embeddings are cached by normalized text hash plus model name. Unchanged tender text reuses its existing vector, and the business profile vector is only regenerated when the submitted description changes.

In production, onboarding stores the company website and LinkedIn URL in Cloudflare D1 under an anonymous browser session id. The session id is generated in the browser and saved in `localStorage`; it is used only to group profile data and search jobs before proper authentication exists.

## ProZorro Tender Agent

Production also exposes a Cloudflare Agents SDK Durable Object for stateful per-company ProZorro monitoring:

```http
POST /agents/tender-intel-agent/{companyId}/onboard
Content-Type: application/json

{
  "companyWebsite": "https://szef-montaz.pl/en/home/",
  "linkedinUrl": "https://www.linkedin.com/company/szef-monta%C5%BC/",
  "minValueUah": 300000
}
```

```http
POST /agents/tender-intel-agent/{companyId}/search
Content-Type: application/json

{
  "minValueUah": 300000,
  "maxPages": 8
}
```

The agent stores company state durably, derives CPV prefixes and Ukrainian semantic keywords, fetches only `active.tendering` ProZorro tenders, filters by value, scores CPV and semantic matches, penalizes false positives, and returns bid/maybe/skip decisions.

## Useful Environment Variables

- `PORT`: Backend port, defaults to `8787`
- `CLIENT_ORIGIN`: Allowed CORS origin, defaults to `http://127.0.0.1:5173`
- `USE_MOCK_PROCUREMENT_API=true`: Force deterministic mock data
- `PROCUREMENT_API_TIMEOUT_MS`: Upstream timeout, defaults to `8000`
- `FIND_TENDER_LOOKBACK_DAYS`: Live API lookback window, defaults to `120`
- `FIND_TENDER_PAGE_LIMIT`: Live API page size, defaults to `100`
- `FIND_TENDER_MAX_PAGES`: Live API pages to inspect, defaults to `2`
- `EMBEDDING_MODEL_NAME`: Local Transformers.js model, defaults to `Xenova/all-MiniLM-L6-v2`
- `EMBEDDING_DEVICE`: Embedding execution device. Defaults to the platform GPU backend: `dml` on Windows, `cuda` on Linux, `coreml` on macOS.
- `EMBEDDING_BATCH_SIZE`: Number of tender embeddings processed before persisting and publishing progress, defaults to `25`
- `TRANSFORMERS_CACHE_DIR`: Model cache directory, defaults to `.data/transformers-cache`
- `TRANSFORMERS_ALLOW_REMOTE_MODELS=false`: Require the embedding model to already exist in the local cache
- `VECTOR_STORE_PATH`: Persisted vector database path, defaults to `.data/vector-store.json`
- `SERVER_LOG_PATH`: Server progress log file, defaults to `.data/server.log`
- `TENDER_INTEL_LLM_MODEL`: Workers AI model for company profile extraction in the ProZorro agent.
- `PROZORRO_BASE_URL`: ProZorro public procurement API base URL.
- `PROZORRO_FEED_PAGES`: Number of recent feed pages the ProZorro agent scans by default.
- `PROZORRO_FEED_LIMIT`: Tender feed page size used by the ProZorro agent.

Embedding progress, selected device, cache hits, vector indexing progress, and final match summaries are written to the server log file as well as stdout.

## Verification

```bash
npm run typecheck
npm run build
```

## Cloudflare Deployment

Production is configured for Cloudflare Workers in `wrangler.toml`.

```bash
npx wrangler d1 create gtm-hack-tender-discovery
# copy the returned database_id into wrangler.toml
npm run deploy:migrations
npm run deploy
```

GitHub Actions deploys on pushes to `main` with `.github/workflows/deploy-cloudflare.yml`. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as repository secrets before enabling CI/CD.

See `docs/cloudflare-workers-deployment.md` for the D1 schema, Workers AI embedding path, custom domain setup, and first deploy checklist.
