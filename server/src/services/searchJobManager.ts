import { randomUUID } from "node:crypto";
import type { SearchProgress, SearchResponse, Tender, TenderMatch } from "../../../shared/tender.js";
import { hashText } from "../utils/hash.js";
import { logError, logInfo } from "../utils/logger.js";
import { classifyQuality, cosineSimilarity, VectorStore } from "./vectorStore.js";

interface CreateSearchJobInput {
  businessSpecification: string;
  queryTerms: string[];
  source: SearchResponse["source"];
  sourceWarnings: string[];
  tenders: Tender[];
}

interface SearchJob {
  id: string;
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

const DEFAULT_BATCH_SIZE = 25;
const jobs = new Map<string, SearchJob>();

function readBatchSize(): number {
  const parsed = Number(process.env.EMBEDDING_BATCH_SIZE);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
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

  if (left.embeddingStatus === "ready" && right.embeddingStatus === "ready") {
    if (right.matchScore !== left.matchScore) {
      return right.matchScore - left.matchScore;
    }
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

  if (job.progress.businessEmbeddingReused !== null) {
    warnings.push(
      job.progress.businessEmbeddingReused
        ? "Reused cached embedding for unchanged business profile."
        : "Generated a new embedding for the changed business profile."
    );
  }

  warnings.push(
    `Tender embeddings reused: ${job.progress.tenderEmbeddingsReused}; created: ${job.progress.tenderEmbeddingsCreated}.`
  );

  if (job.error) {
    warnings.push(job.error);
  }

  return warnings;
}

function toResponse(job: SearchJob): SearchResponse {
  return {
    searchId: job.id,
    status: job.status,
    queryTerms: job.queryTerms,
    businessProfileHash: job.businessProfileHash,
    source: job.source,
    tenders: [...job.tenders].sort(compareTenders),
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export class SearchJobManager {
  constructor(private readonly vectorStore: VectorStore) {}

  create(input: CreateSearchJobInput): SearchResponse {
    const now = new Date().toISOString();
    const job: SearchJob = {
      id: randomUUID(),
      status: "processing",
      businessSpecification: input.businessSpecification,
      businessProfileHash: hashText(input.businessSpecification),
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

    jobs.set(job.id, job);
    void this.process(job);

    logInfo("Progressive tender search job created", {
      searchId: job.id,
      candidates: job.tenders.length,
      batchSize: readBatchSize()
    });

    return toResponse(job);
  }

  get(searchId: string): SearchResponse | null {
    const job = jobs.get(searchId);

    return job ? toResponse(job) : null;
  }

  private async process(job: SearchJob): Promise<void> {
    const startedAt = performance.now();
    const batchSize = readBatchSize();

    try {
      await this.vectorStore.load();

      const profile = await this.vectorStore.getOrCreateBusinessProfile(job.businessSpecification);
      job.progress = {
        ...job.progress,
        businessEmbeddingReused: profile.cacheHit,
        isBusinessEmbeddingReady: true
      };
      job.updatedAt = new Date().toISOString();

      logInfo("Progressive tender search profile ready", {
        searchId: job.id,
        businessEmbeddingReused: profile.cacheHit,
        candidateTenders: job.tenders.length
      });

      for (let start = 0; start < job.tenders.length; start += batchSize) {
        const batch = job.tenders.slice(start, start + batchSize);

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

            logError("Progressive tender embedding failed", {
              searchId: job.id,
              tenderId: tender.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        await this.vectorStore.persist();
        updateProgress(job);

        logInfo("Progressive tender search batch completed", {
          searchId: job.id,
          processed: job.progress.completed,
          total: job.progress.total,
          pending: job.progress.pending,
          tenderEmbeddingsReused: job.progress.tenderEmbeddingsReused,
          tenderEmbeddingsCreated: job.progress.tenderEmbeddingsCreated
        });

        await yieldToEventLoop();
      }

      job.status = "complete";
      updateProgress(job);

      logInfo("Progressive tender search job completed", {
        searchId: job.id,
        total: job.progress.total,
        tenderEmbeddingsReused: job.progress.tenderEmbeddingsReused,
        tenderEmbeddingsCreated: job.progress.tenderEmbeddingsCreated,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    } catch (error) {
      job.status = "failed";
      job.error = `Embedding job failed: ${error instanceof Error ? error.message : String(error)}`;
      updateProgress(job);

      logError("Progressive tender search job failed", {
        searchId: job.id,
        error: job.error,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    }
  }
}
