# Vector Search Design

## Goal

The first prototype used keyword extraction for matching. The current implementation keeps keyword extraction only for visibility in the UI and logs, but ranking is now semantic:

1. Fetch candidate tenders from Find a Tender.
2. Return the visible tender list immediately with `embeddingStatus: "pending"` and score `0`.
3. Create an in-memory search job.
4. Convert the business profile into a dense vector embedding.
5. Convert candidate tenders into dense vector embeddings in batches.
6. Store vectors in a local persisted vector database after each batch.
7. Rank tenders by cosine similarity as each batch becomes ready.
8. Let the frontend poll for updated scores until the job is complete.

Implementation files:

- `server/src/services/embeddingService.ts`
- `server/src/services/searchJobManager.ts`
- `server/src/services/vectorStore.ts`
- `server/src/utils/tenderText.ts`
- `server/src/utils/hash.ts`
- `server/src/routes/search.ts`

## Embedding Model

The embedding model is run locally with Hugging Face Transformers.js:

```text
Xenova/all-MiniLM-L6-v2
```

This model produces 384-dimensional embeddings and is small enough for a local prototype while still being useful for semantic matching.

Configurable environment variables:

- `EMBEDDING_MODEL_NAME`: model name, defaults to `Xenova/all-MiniLM-L6-v2`
- `EMBEDDING_DEVICE`: execution device
- `TRANSFORMERS_CACHE_DIR`: model cache, defaults to `.data/transformers-cache`
- `TRANSFORMERS_ALLOW_REMOTE_MODELS=false`: disables model download and requires local cache

## GPU Execution

The embedding service chooses a platform GPU backend by default:

- Windows: `dml` via DirectML
- Linux: `cuda`
- macOS: `coreml`
- fallback/default override: `gpu`

On this Windows development machine, `dml` is used because the generic `gpu` provider caused ONNX Runtime to combine incompatible GPU providers. DirectML initialized successfully and generated embeddings.

You can override manually:

```bash
EMBEDDING_DEVICE=dml
EMBEDDING_DEVICE=cuda
EMBEDDING_DEVICE=webgpu
EMBEDDING_DEVICE=cpu
```

## What Becomes an Embedding

### Business Profile

The user-submitted `businessSpecification` string is embedded directly.

No summarization or rewriting is applied before embedding. The exact submitted text is normalized only for cache hashing, not for the embedding model input. This preserves domain terms, service descriptions, buyer language, and long-tail capability details.

### Tender Text

Each normalized tender is converted into searchable text with:

```ts
[
  tender.title,
  tender.buyerName,
  tender.description,
  tender.value > 0 ? `${tender.value} ${tender.currency}` : "",
  tender.documentationUrls.join(" ")
].join("\n")
```

This text is built in `server/src/utils/tenderText.ts`.

The tender description itself already includes:

- OCDS `tender.description`
- `procurementMethodDetails`
- item descriptions
- CPV classification descriptions

This means the tender vector includes both human-readable scope and useful procurement classification context.

## Vector Store

The vector database is a local file-backed store at:

```text
.data/vector-store.json
```

It stores records shaped like:

- record ID
- record type: `business-profile` or `tender`
- normalized text hash
- model name
- vector dimensions
- embedding vector
- update timestamp
- normalized tender payload for tender records

This is intentionally simple and embedded for a hackathon prototype. It avoids requiring a local Postgres/pgvector, Chroma, or Pinecone service while preserving the important vector database behavior:

- persisted vectors
- reusable embeddings
- cosine similarity lookup
- stable tender records
- model-aware cache keys

For production, this layer is the natural replacement point for pgvector, Chroma, Pinecone, Weaviate, or another vector database.

## Cache Keys and Reuse

Embeddings are not regenerated if the same text has already been embedded for the same model.

Hashing:

```ts
sha256(text.replace(/\s+/g, " ").trim().toLowerCase())
```

Business profile key:

```text
business-profile:<modelName>:profile-<businessProfileHash>:<businessProfileHash>
```

Tender key:

```text
tender:<modelName>:<tenderId>:<tenderTextHash>
```

Design consequences:

- If the business description is unchanged, its vector is reused.
- If the business description changes, only that business profile embedding is regenerated.
- If a tender ID is the same but its title/scope/doc URLs change, the text hash changes and the tender embedding is regenerated.
- If a tender is fetched again unchanged, its vector is reused.
- Changing the embedding model naturally creates a separate vector namespace.

The selected device is not part of the cache key. A vector generated on CPU and a vector generated on GPU should be numerically equivalent for this use case; forcing recomputation only because execution hardware changed would waste time.

## Search Algorithm

The search flow in `POST /api/search` is:

1. Validate `businessSpecification`.
2. Extract lightweight keywords for UI/log visibility.
3. Fetch candidate tenders from the procurement client.
4. Keep active tenders only.
5. Create a search job ID.
6. Return all active tenders immediately as pending matches:

```ts
{
  matchScore: 0,
  matchQuality: "low",
  embeddingStatus: "pending"
}
```

The background job then:

1. Loads the vector store from disk.
2. Gets or creates the business profile embedding.
3. Processes tenders in batches controlled by `EMBEDDING_BATCH_SIZE`, default `25`.
4. Gets or creates each tender embedding.
5. Computes cosine similarity between the business profile vector and each tender vector.
6. Persists new vectors after each batch.
7. Updates the in-memory job state.
8. Marks the job as `complete` when no pending tenders remain.

The frontend polls:

```text
GET /api/search/:searchId
```

while `status` is `processing`.

This avoids waiting for hundreds or thousands of embeddings before showing the user any results.

The cosine implementation uses dot product because embeddings are L2-normalized:

```ts
score = sum(profile[i] * tender[i])
```

## Match Quality

Each tender response includes:

```ts
interface TenderMatch extends Tender {
  matchScore: number;
  matchQuality: "high" | "medium" | "low";
  embeddingStatus: "pending" | "ready" | "failed";
}
```

Current thresholds:

- `high`: score >= `0.62`
- `medium`: score >= `0.42`
- `low`: score < `0.42`

These are prototype thresholds. They should be calibrated with judged relevance data once real users start labeling good and bad matches.

Pending tenders intentionally use score `0` and `low` quality until their embedding is ready. The UI renders them as `- (0%)` with a loading indicator so the user can distinguish "not scored yet" from "scored poorly".

## Progressive Ranking

The response order is updated as embeddings are completed:

1. Ready tenders first, sorted by descending cosine similarity.
2. Pending or failed tenders after ready tenders.
3. Deadline date is used as the tie-breaker inside each group.

This means the list can move while a search is running. That is intentional: the best-known matches rise as soon as their embeddings are available.

## Logging

The server writes progress logs to:

```text
.data/server.log
```

Configurable with:

```bash
SERVER_LOG_PATH=.data/server.log
```

Logged events include:

- server startup and selected embedding device
- tender search request metadata
- source used: live Find a Tender or mock fallback
- candidate tender counts
- vector store load/init/persist
- embedding model load status and download progress
- embedding generation timing and dimensions
- vector indexing progress every 25 tenders
- progressive job batch completion
- cache reuse counts
- final top match and elapsed time

This matters because the first model load can take noticeably longer than subsequent searches, especially while model files are downloading or while the GPU provider initializes.
