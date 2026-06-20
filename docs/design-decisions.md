# Major Design Decisions

## 1. Use Find a Tender OCDS as the Live Source

The prototype uses the UK Find a Tender OCDS release package API because it is public, open, structured, and does not require an API key. OCDS also maps cleanly to a normalized local `Tender` interface.

SAM.gov was not used because production access usually requires an API key and would make local demo setup less reliable.

## 2. Fetch Candidate Notices First, Then Rank Locally

The Find a Tender OCDS release package endpoint is used as a structured feed, not as a semantic search engine. The backend fetches recent tender-stage releases and performs semantic matching locally.

This keeps ranking behavior under our control and makes the vector search implementation source-agnostic. A future source can be added by mapping it into the same `Tender` interface.

## 3. Keep Keyword Extraction, But Do Not Use It for Ranking

The app still extracts key terms from the business profile. These are useful for:

- showing the user what the system noticed
- debugging search requests
- server logs

They are no longer the primary ranking mechanism. Semantic ranking uses embeddings and cosine similarity.

## 4. Use Local Transformers Instead of a Hosted Embedding API

Embeddings are generated with local Hugging Face Transformers.js. This keeps the prototype self-contained and avoids sending potentially sensitive business profiles to a third-party API.

Tradeoffs:

- first run downloads model files
- local inference is slower than many hosted embedding APIs
- GPU provider compatibility must be handled per platform

The benefit is that the prototype remains runnable with only Node.js and npm.

## 5. Prefer GPU, But Keep Device Configurable

Embeddings default to a platform GPU backend:

- Windows: DirectML (`dml`)
- Linux: CUDA (`cuda`)
- macOS: CoreML (`coreml`)

This was chosen after testing on Windows. The generic `gpu` option attempted to use incompatible ONNX Runtime providers, while `dml` initialized successfully.

The device can be overridden with `EMBEDDING_DEVICE` for machines where another provider is preferred.

## 6. Use a File-Backed Vector Store for the Prototype

The implementation uses `.data/vector-store.json` as a lightweight local vector database.

Why:

- no extra services to install
- easy to inspect
- deterministic for hackathon/demo work
- captures the core behavior of vector storage and cosine search

What would change in production:

- move vectors to pgvector, Chroma, Pinecone, Weaviate, or similar
- add metadata filters at query time
- add incremental ingestion jobs
- add deduplication and retention rules
- add relevance evaluation and threshold calibration

## 7. Cache Embeddings by Text Hash and Model

Embedding generation is expensive relative to simple JSON processing. The system avoids regenerating vectors for unchanged text.

Cache identity uses:

- normalized text hash
- model name
- tender ID for tender records
- record type

The execution device is not part of the cache key because the semantic vector should be equivalent across CPU/GPU providers for this use case.

## 8. Store Normalized Tender Payloads With Tender Vectors

Tender vector records include the normalized `Tender` payload. This makes search results easy to reconstruct from the vector store after indexing and keeps the vector result tied to the exact text that generated it.

For production, this may be split into:

- relational tender table
- vector table
- document table
- ingestion audit table

## 9. Rank by Cosine Similarity, Then Deadline

Primary ranking is semantic similarity. Deadline is only a tie-breaker.

This matches the user requirement to rank by match quality. A near-deadline tender that is a poor semantic fit should not outrank a strong fit merely because it closes soon.

The UI still displays strict deadline warnings so users can act quickly when a good match is urgent.

## 10. Show Tenders Before Embeddings Are Complete

The search API is now progressive. It returns the candidate tender list immediately with pending match scores, then embeds and ranks tenders in background batches.

This was chosen because embedding thousands of tenders can take long enough to make a blocking search feel broken. A user should be able to start reading candidate opportunities while semantic ranking improves in the background.

Pending tenders show score `0` and an embedding loading state. Once a tender vector is ready, the score and ranking are updated by polling `GET /api/search/:searchId`.

## 11. Active Tenders Only

The route filters to active tenders before vector ranking.

Closed tenders may still be useful for market intelligence later, but the initial product goal is opportunity discovery, so surfacing actionable tenders is the better default.

## 12. Log Progress to a File

Embedding and vector indexing can have visible latency, especially on first run. Logs are written to `.data/server.log` so long-running model loads and indexing progress can be inspected without attaching a debugger.

The log is intentionally plain text with JSON context after each message, which keeps it readable for humans and easy to parse later.

## 13. Mock Fallback Uses the Same Pipeline

Mock procurement data is represented in an OCDS-like shape and passes through the same normalizer, vector store, embedding generation, and UI rendering as live data.

This avoids a fake demo path. When live data is unavailable, the app still exercises the same operational logic.
