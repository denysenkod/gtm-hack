import { z } from "zod";
import type { SearchProgress, SearchResponse, Tender, TenderMatch } from "../../shared/tender.js";
import { FindTenderClient } from "../../server/src/clients/findTenderClient.js";
import { extractKeyTerms } from "../../server/src/utils/text.js";
import { tenderToSearchText } from "../../server/src/utils/tenderText.js";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AI: Ai;
  FIND_TENDER_BASE_URL?: string;
  FIND_TENDER_LOOKBACK_DAYS?: string;
  FIND_TENDER_PAGE_LIMIT?: string;
  FIND_TENDER_MAX_PAGES?: string;
  PROCUREMENT_API_TIMEOUT_MS?: string;
  USE_MOCK_PROCUREMENT_API?: string;
  EMBEDDING_BATCH_SIZE?: string;
  WORKERS_AI_EMBEDDING_MODEL?: string;
}

type VectorRecordType = "business-profile" | "tender";

interface VectorRecord {
  key: string;
  type: VectorRecordType;
  externalId: string;
  textHash: string;
  modelName: string;
  dimensions: number;
  embedding: number[];
  updatedAt: string;
  tender?: Tender;
}

interface VectorRow {
  key: string;
  record_type: VectorRecordType;
  external_id: string;
  text_hash: string;
  model_name: string;
  dimensions: number;
  embedding_json: string;
  tender_json: string | null;
  updated_at: string;
}

interface SearchJob {
  id: string;
  browserSessionId?: string;
  status: SearchResponse["status"];
  businessSpecification: string;
  businessProfileHash: string;
  queryTerms: string[];
  source: SearchResponse["source"];
  sourceWarnings: string[];
  tenders: TenderMatch[];
  progress: SearchProgress;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface SearchJobRow {
  id: string;
  browser_session_id?: string | null;
  status: SearchResponse["status"];
  business_specification: string;
  business_profile_hash: string;
  query_terms_json: string;
  source: SearchResponse["source"];
  source_warnings_json: string;
  tenders_json: string;
  progress_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateSearchJobInput {
  browserSessionId?: string;
  businessSpecification: string;
  queryTerms: string[];
  source: SearchResponse["source"];
  sourceWarnings: string[];
  tenders: Tender[];
}

interface IndexedVector {
  embedding: number[];
  cacheHit: boolean;
}

interface AiEmbeddingResponse {
  shape?: number[];
  data: number[] | number[][];
  pooling?: string;
}

interface OnboardingProfile {
  browserSessionId: string;
  companyWebsite: string;
  linkedinUrl: string;
}

interface OnboardingProfileRow {
  session_id: string;
  company_website: string;
  linkedin_url: string;
  created_at: string;
  updated_at: string;
}

const browserSessionIdSchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

const requestSchema = z.object({
  browserSessionId: browserSessionIdSchema.optional(),
  businessSpecification: z.string().trim().min(20).max(12000)
});

const profileSchema = z.object({
  browserSessionId: browserSessionIdSchema,
  companyWebsite: z.string().trim().url().max(2048),
  linkedinUrl: z.string().trim().url().max(2048)
});

const DEFAULT_BASE_URL = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const DEFAULT_LOOKBACK_DAYS = 120;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

function readBoolean(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init?.headers
    }
  });
}

function createFindTenderClient(env: Env): FindTenderClient {
  return new FindTenderClient({
    baseUrl: env.FIND_TENDER_BASE_URL ?? DEFAULT_BASE_URL,
    timeoutMs: readNumber(env.PROCUREMENT_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    lookbackDays: readNumber(env.FIND_TENDER_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS),
    pageLimit: readNumber(env.FIND_TENDER_PAGE_LIMIT, DEFAULT_PAGE_LIMIT),
    maxPages: readNumber(env.FIND_TENDER_MAX_PAGES, DEFAULT_MAX_PAGES),
    useMock: readBoolean(env.USE_MOCK_PROCUREMENT_API)
  });
}

function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function sha256(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashText(text: string): Promise<string> {
  return sha256(normalizeForHash(text));
}

function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;

  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return dot;
}

function classifyQuality(score: number): TenderMatch["matchQuality"] {
  if (score >= 0.62) {
    return "high";
  }

  if (score >= 0.42) {
    return "medium";
  }

  return "low";
}

function createPendingMatch(tender: Tender): TenderMatch {
  return {
    ...tender,
    matchScore: 0,
    matchQuality: "low",
    embeddingStatus: "pending"
  };
}

function compareTenders(left: TenderMatch, right: TenderMatch): number {
  if (left.embeddingStatus === "ready" && right.embeddingStatus !== "ready") {
    return -1;
  }

  if (left.embeddingStatus !== "ready" && right.embeddingStatus === "ready") {
    return 1;
  }

  if (left.embeddingStatus === "ready" && right.embeddingStatus === "ready" && right.matchScore !== left.matchScore) {
    return right.matchScore - left.matchScore;
  }

  return Date.parse(left.deadlineDate) - Date.parse(right.deadlineDate);
}

function buildWarnings(job: SearchJob): string[] {
  const warnings = [...job.sourceWarnings];

  if (job.status === "processing") {
    warnings.push(
      "Semantic matching is running in background batches. Pending tenders show score 0 until their embedding is ready."
    );
  }

  if (job.error) {
    warnings.push(job.error);
  }

  return warnings;
}

function toResponse(job: SearchJob): SearchResponse {
  const tenders = job.tenders.map((tender) => {
    if (job.status !== "processing" && tender.embeddingStatus === "pending") {
      return {
        ...tender,
        embeddingStatus: "failed" as const
      };
    }

    return tender;
  });

  return {
    searchId: job.id,
    status: job.status,
    queryTerms: job.queryTerms,
    businessProfileHash: job.businessProfileHash,
    source: job.source,
    tenders: tenders.sort(compareTenders),
    warnings: buildWarnings(job),
    progress: job.progress
  };
}

function updateProgress(job: SearchJob): void {
  const completed = job.tenders.filter((tender) => tender.embeddingStatus !== "pending").length;

  job.progress = {
    ...job.progress,
    completed,
    pending: Math.max(job.progress.total - completed, 0)
  };
  job.updatedAt = new Date().toISOString();
}

function vectorRecordKey(type: VectorRecordType, modelName: string, externalId: string, textHash: string): string {
  return [type, modelName, externalId, textHash].join(":");
}

function vectorFromRow(row: VectorRow): VectorRecord {
  const tender = row.tender_json ? (JSON.parse(row.tender_json) as Tender) : undefined;

  return {
    key: row.key,
    type: row.record_type,
    externalId: row.external_id,
    textHash: row.text_hash,
    modelName: row.model_name,
    dimensions: row.dimensions,
    embedding: JSON.parse(row.embedding_json) as number[],
    updatedAt: row.updated_at,
    ...(tender ? { tender } : {})
  };
}

function jobFromRow(row: SearchJobRow): SearchJob {
  const error = row.error ?? undefined;
  const browserSessionId = row.browser_session_id ?? undefined;

  return {
    id: row.id,
    ...(browserSessionId ? { browserSessionId } : {}),
    status: row.status,
    businessSpecification: row.business_specification,
    businessProfileHash: row.business_profile_hash,
    queryTerms: JSON.parse(row.query_terms_json) as string[],
    source: row.source,
    sourceWarnings: JSON.parse(row.source_warnings_json) as string[],
    tenders: JSON.parse(row.tenders_json) as TenderMatch[],
    progress: JSON.parse(row.progress_json) as SearchProgress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(error ? { error } : {})
  };
}

function extractEmbedding(response: AiEmbeddingResponse): number[] {
  const data = response.data;
  const first = Array.isArray(data[0]) ? data[0] : data;
  const vector = first as number[];

  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => typeof value !== "number")) {
    throw new Error("Workers AI embedding response did not contain a numeric vector.");
  }

  return l2Normalize(vector);
}

class D1Storage {
  constructor(private readonly db: D1Database) {}

  async upsertBrowserSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO browser_sessions (
          session_id,
          created_at,
          last_seen_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at`
      )
      .bind(sessionId, now, now)
      .run();
  }

  async upsertOnboardingProfile(profile: OnboardingProfile): Promise<void> {
    const now = new Date().toISOString();

    await this.upsertBrowserSession(profile.browserSessionId);
    await this.db
      .prepare(
        `INSERT INTO onboarding_profiles (
          session_id,
          company_website,
          linkedin_url,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          company_website = excluded.company_website,
          linkedin_url = excluded.linkedin_url,
          updated_at = excluded.updated_at`
      )
      .bind(profile.browserSessionId, profile.companyWebsite, profile.linkedinUrl, now, now)
      .run();
  }

  async getOnboardingProfile(sessionId: string): Promise<OnboardingProfile | null> {
    const row = await this.db
      .prepare("SELECT * FROM onboarding_profiles WHERE session_id = ?")
      .bind(sessionId)
      .first<OnboardingProfileRow>();

    if (!row) {
      return null;
    }

    return {
      browserSessionId: row.session_id,
      companyWebsite: row.company_website,
      linkedinUrl: row.linkedin_url
    };
  }

  async getVector(key: string): Promise<VectorRecord | null> {
    const row = await this.db.prepare("SELECT * FROM vector_records WHERE key = ?").bind(key).first<VectorRow>();

    return row ? vectorFromRow(row) : null;
  }

  async upsertVector(record: VectorRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO vector_records (
          key,
          record_type,
          external_id,
          text_hash,
          model_name,
          dimensions,
          embedding_json,
          tender_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          external_id = excluded.external_id,
          text_hash = excluded.text_hash,
          model_name = excluded.model_name,
          dimensions = excluded.dimensions,
          embedding_json = excluded.embedding_json,
          tender_json = excluded.tender_json,
          updated_at = excluded.updated_at`
      )
      .bind(
        record.key,
        record.type,
        record.externalId,
        record.textHash,
        record.modelName,
        record.dimensions,
        JSON.stringify(record.embedding),
        record.tender ? JSON.stringify(record.tender) : null,
        record.updatedAt
      )
      .run();
  }

  async getJob(id: string): Promise<SearchJob | null> {
    const row = await this.db.prepare("SELECT * FROM search_jobs WHERE id = ?").bind(id).first<SearchJobRow>();

    return row ? jobFromRow(row) : null;
  }

  async upsertJob(job: SearchJob): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO search_jobs (
          id,
          browser_session_id,
          status,
          business_specification,
          business_profile_hash,
          query_terms_json,
          source,
          source_warnings_json,
          tenders_json,
          progress_json,
          error,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          browser_session_id = excluded.browser_session_id,
          status = excluded.status,
          business_specification = excluded.business_specification,
          business_profile_hash = excluded.business_profile_hash,
          query_terms_json = excluded.query_terms_json,
          source = excluded.source,
          source_warnings_json = excluded.source_warnings_json,
          tenders_json = excluded.tenders_json,
          progress_json = excluded.progress_json,
          error = excluded.error,
          updated_at = excluded.updated_at`
      )
      .bind(
        job.id,
        job.browserSessionId ?? null,
        job.status,
        job.businessSpecification,
        job.businessProfileHash,
        JSON.stringify(job.queryTerms),
        job.source,
        JSON.stringify(job.sourceWarnings),
        JSON.stringify(job.tenders),
        JSON.stringify(job.progress),
        job.error ?? null,
        job.createdAt,
        job.updatedAt
      )
      .run();
  }
}

class WorkersAiEmbeddingService {
  constructor(
    private readonly ai: Ai,
    readonly modelName: string
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = (await this.ai.run(this.modelName as never, {
      text: [text],
      pooling: "mean"
    } as never)) as unknown as AiEmbeddingResponse;

    return extractEmbedding(response);
  }
}

class D1VectorStore {
  constructor(
    private readonly storage: D1Storage,
    private readonly embeddings: WorkersAiEmbeddingService
  ) {}

  async getOrCreateBusinessProfile(profileText: string): Promise<IndexedVector & { hash: string }> {
    const textHash = await hashText(profileText);
    const externalId = `profile-${textHash}`;
    const key = vectorRecordKey("business-profile", this.embeddings.modelName, externalId, textHash);
    const existing = await this.storage.getVector(key);

    if (existing) {
      return {
        hash: textHash,
        embedding: existing.embedding,
        cacheHit: true
      };
    }

    const embedding = await this.embeddings.embed(profileText);
    await this.storage.upsertVector({
      key,
      type: "business-profile",
      externalId,
      textHash,
      modelName: this.embeddings.modelName,
      dimensions: embedding.length,
      embedding,
      updatedAt: new Date().toISOString()
    });

    return {
      hash: textHash,
      embedding,
      cacheHit: false
    };
  }

  async getOrCreateTender(tender: Tender): Promise<IndexedVector> {
    const tenderText = tenderToSearchText(tender);
    const textHash = await hashText(tenderText);
    const key = vectorRecordKey("tender", this.embeddings.modelName, tender.id, textHash);
    const existing = await this.storage.getVector(key);

    if (existing) {
      if (JSON.stringify(existing.tender) !== JSON.stringify(tender)) {
        await this.storage.upsertVector({
          ...existing,
          tender,
          updatedAt: new Date().toISOString()
        });
      }

      return {
        embedding: existing.embedding,
        cacheHit: true
      };
    }

    const embedding = await this.embeddings.embed(tenderText);
    await this.storage.upsertVector({
      key,
      type: "tender",
      externalId: tender.id,
      textHash,
      modelName: this.embeddings.modelName,
      dimensions: embedding.length,
      embedding,
      tender,
      updatedAt: new Date().toISOString()
    });

    return {
      embedding,
      cacheHit: false
    };
  }
}

class D1SearchJobManager {
  constructor(
    private readonly storage: D1Storage,
    private readonly vectorStore: D1VectorStore,
    private readonly batchSize: number
  ) {}

  async create(input: CreateSearchJobInput, ctx: ExecutionContext): Promise<SearchResponse> {
    const now = new Date().toISOString();
    const businessProfileHash = await hashText(input.businessSpecification);
    if (input.browserSessionId) {
      await this.storage.upsertBrowserSession(input.browserSessionId);
    }

    const job: SearchJob = {
      id: crypto.randomUUID(),
      ...(input.browserSessionId ? { browserSessionId: input.browserSessionId } : {}),
      status: "processing",
      businessSpecification: input.businessSpecification,
      businessProfileHash,
      queryTerms: input.queryTerms,
      source: input.source,
      sourceWarnings: input.sourceWarnings,
      tenders: input.tenders.map(createPendingMatch),
      progress: {
        total: input.tenders.length,
        completed: 0,
        pending: input.tenders.length,
        tenderEmbeddingsReused: 0,
        tenderEmbeddingsCreated: 0,
        businessEmbeddingReused: null,
        isBusinessEmbeddingReady: false
      },
      createdAt: now,
      updatedAt: now
    };

    await this.storage.upsertJob(job);
    ctx.waitUntil(this.process(job.id));

    return toResponse(job);
  }

  async get(searchId: string): Promise<SearchResponse | null> {
    const job = await this.storage.getJob(searchId);

    return job ? toResponse(job) : null;
  }

  private async process(searchId: string): Promise<void> {
    const job = await this.storage.getJob(searchId);

    if (!job) {
      return;
    }

    try {
      const profile = await this.vectorStore.getOrCreateBusinessProfile(job.businessSpecification);
      job.progress = {
        ...job.progress,
        businessEmbeddingReused: profile.cacheHit,
        isBusinessEmbeddingReady: true
      };
      job.updatedAt = new Date().toISOString();
      await this.storage.upsertJob(job);

      for (let start = 0; start < job.tenders.length; start += this.batchSize) {
        const batch = job.tenders.slice(start, start + this.batchSize);

        for (const tender of batch) {
          if (tender.embeddingStatus !== "pending") {
            continue;
          }

          try {
            const indexedTender = await this.vectorStore.getOrCreateTender(tender);
            const matchScore = cosineSimilarity(profile.embedding, indexedTender.embedding);

            tender.matchScore = matchScore;
            tender.matchQuality = classifyQuality(matchScore);
            tender.embeddingStatus = "ready";

            if (indexedTender.cacheHit) {
              job.progress.tenderEmbeddingsReused += 1;
            } else {
              job.progress.tenderEmbeddingsCreated += 1;
            }
          } catch (error) {
            tender.embeddingStatus = "failed";
            tender.matchScore = 0;
            tender.matchQuality = "low";
            console.error("Progressive tender embedding failed", {
              searchId: job.id,
              tenderId: tender.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        updateProgress(job);
        await this.storage.upsertJob(job);
      }

      for (const tender of job.tenders) {
        if (tender.embeddingStatus === "pending") {
          tender.embeddingStatus = "failed";
        }
      }

      job.status = "complete";
      updateProgress(job);
      await this.storage.upsertJob(job);
    } catch (error) {
      job.status = "failed";
      job.error = `Embedding job failed: ${error instanceof Error ? error.message : String(error)}`;
      updateProgress(job);
      await this.storage.upsertJob(job);
      console.error("Progressive tender search job failed", {
        searchId: job.id,
        error: job.error
      });
    }
  }
}

function createManagers(env: Env): {
  storage: D1Storage;
  searchJobs: D1SearchJobManager;
} {
  const storage = new D1Storage(env.DB);
  const modelName = env.WORKERS_AI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const embeddings = new WorkersAiEmbeddingService(env.AI, modelName);
  const vectorStore = new D1VectorStore(storage, embeddings);
  const searchJobs = new D1SearchJobManager(storage, vectorStore, readNumber(env.EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE));

  return { storage, searchJobs };
}

async function handleProfileCreate(request: Request, env: Env): Promise<Response> {
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonResponse(
      {
        error: "Please provide a valid browserSessionId, companyWebsite, and linkedinUrl."
      },
      { status: 400 }
    );
  }

  const { storage } = createManagers(env);
  await storage.upsertOnboardingProfile(parsed.data);

  return jsonResponse({
    status: "ok"
  });
}

async function handleProfileGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parsedSessionId = browserSessionIdSchema.safeParse(
    url.searchParams.get("browserSessionId") ?? request.headers.get("x-browser-session-id")
  );

  if (!parsedSessionId.success) {
    return jsonResponse(
      {
        error: "Please provide a valid browserSessionId."
      },
      { status: 400 }
    );
  }

  const { storage } = createManagers(env);
  const profile = await storage.getOnboardingProfile(parsedSessionId.data);

  if (!profile) {
    return jsonResponse(
      {
        error: "Profile not found."
      },
      { status: 404 }
    );
  }

  return jsonResponse(profile);
}

async function handleSearchCreate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonResponse(
      {
        error: "Please provide a businessSpecification between 20 and 12,000 characters."
      },
      { status: 400 }
    );
  }

  const queryTerms = extractKeyTerms(parsed.data.businessSpecification);

  if (queryTerms.length === 0) {
    return jsonResponse(
      {
        error: "Please include enough descriptive words to create a tender search query."
      },
      { status: 400 }
    );
  }

  const client = createFindTenderClient(env);
  const result = await client.search();
  const activeTenders = result.tenders.filter((tender) => tender.status === "active");
  const { searchJobs } = createManagers(env);
  const payload = await searchJobs.create(
    {
      ...(parsed.data.browserSessionId ? { browserSessionId: parsed.data.browserSessionId } : {}),
      businessSpecification: parsed.data.businessSpecification,
      queryTerms,
      source: result.source,
      sourceWarnings: result.warnings,
      tenders: activeTenders
    },
    ctx
  );

  return jsonResponse(payload);
}

async function handleSearchGet(searchId: string, env: Env): Promise<Response> {
  const { searchJobs } = createManagers(env);
  const payload = await searchJobs.get(searchId);

  if (!payload) {
    return jsonResponse(
      {
        error: "Search job not found."
      },
      { status: 404 }
    );
  }

  return jsonResponse(payload);
}

async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({
      status: "ok",
      service: "tender-discovery",
      runtime: "cloudflare-workers"
    });
  }

  if (url.pathname === "/api/profile" && request.method === "POST") {
    return handleProfileCreate(request, env);
  }

  if (url.pathname === "/api/profile" && request.method === "GET") {
    return handleProfileGet(request, env);
  }

  if (url.pathname === "/api/search" && request.method === "POST") {
    return handleSearchCreate(request, env, ctx);
  }

  const searchMatch = /^\/api\/search\/([^/]+)$/.exec(url.pathname);
  if (searchMatch && request.method === "GET") {
    return handleSearchGet(decodeURIComponent(searchMatch[1] ?? ""), env);
  }

  return jsonResponse(
    {
      error: "API route not found."
    },
    { status: 404 }
  );
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApiRequest(request, env, ctx);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled Worker error", {
        error: error instanceof Error ? error.message : String(error)
      });

      return jsonResponse(
        {
          error: "Unexpected server error while searching for tenders."
        },
        { status: 500 }
      );
    }
  }
} satisfies ExportedHandler<Env>;
