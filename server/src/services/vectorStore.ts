import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tender, TenderMatch } from "../../../shared/tender.js";
import type { EmbeddingMetadata, EmbeddingService, EmbeddingVector } from "./embeddingService.js";
import { hashText } from "../utils/hash.js";
import { logInfo } from "../utils/logger.js";
import { tenderToSearchText } from "../utils/tenderText.js";

type VectorRecordType = "business-profile" | "tender";

interface VectorRecord {
  id: string;
  type: VectorRecordType;
  textHash: string;
  modelName: string;
  dimensions: number;
  embedding: EmbeddingVector;
  updatedAt: string;
  tender?: Tender;
}

interface PersistedVectorStore {
  version: 1;
  records: VectorRecord[];
}

export interface BusinessProfileVector {
  id: string;
  hash: string;
  embedding: EmbeddingVector;
  cacheHit: boolean;
}

export interface IndexedTender {
  tender: Tender;
  textHash: string;
  cacheHit: boolean;
}

export interface VectorSearchResult {
  matches: TenderMatch[];
  businessProfileHash: string;
  tenderEmbeddingsReused: number;
  tenderEmbeddingsCreated: number;
  businessEmbeddingReused: boolean;
}

const DEFAULT_STORE_PATH = ".data/vector-store.json";

function cosineSimilarity(left: EmbeddingVector, right: EmbeddingVector): number {
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

function recordKey(
  type: VectorRecordType,
  id: string,
  textHash: string,
  metadata: Pick<EmbeddingMetadata, "modelName">
): string {
  return [type, metadata.modelName, id, textHash].join(":");
}

export class VectorStore {
  private records = new Map<string, VectorRecord>();
  private hasLoaded = false;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly storePath = process.env.VECTOR_STORE_PATH ?? DEFAULT_STORE_PATH
  ) {}

  async indexAndSearch(profileText: string, tenders: Tender[]): Promise<VectorSearchResult> {
    const startedAt = performance.now();
    await this.load();

    logInfo("Vector search started", {
      candidateTenders: tenders.length,
      storePath: this.storePath
    });

    const profile = await this.getOrCreateBusinessProfile(profileText);
    let tenderEmbeddingsReused = 0;
    let tenderEmbeddingsCreated = 0;

    for (const [index, tender] of tenders.entries()) {
      const indexedTender = await this.getOrCreateTender(tender);

      if (indexedTender.cacheHit) {
        tenderEmbeddingsReused += 1;
      } else {
        tenderEmbeddingsCreated += 1;
      }

      const processed = index + 1;
      if (processed === tenders.length || processed % 25 === 0) {
        logInfo("Vector indexing progress", {
          processed,
          total: tenders.length,
          tenderEmbeddingsReused,
          tenderEmbeddingsCreated
        });
      }
    }

    await this.persist();

    const metadata = this.embeddingService.metadata;
    const matches = [...this.records.values()]
      .filter((record) => {
        return (
          record.type === "tender" &&
          record.modelName === metadata.modelName &&
          record.dimensions === metadata.dimensions &&
          record.tender !== undefined &&
          tenders.some((tender) => tender.id === record.tender?.id)
        );
      })
      .map((record) => {
        const matchScore = cosineSimilarity(profile.embedding, record.embedding);

        return {
          ...record.tender!,
          matchScore,
          matchQuality: classifyQuality(matchScore)
        };
      })
      .sort((left, right) => {
        if (right.matchScore !== left.matchScore) {
          return right.matchScore - left.matchScore;
        }

        return Date.parse(left.deadlineDate) - Date.parse(right.deadlineDate);
      });

    logInfo("Vector search completed", {
      candidateTenders: tenders.length,
      matches: matches.length,
      topScore: matches[0]?.matchScore,
      topTenderId: matches[0]?.id,
      businessEmbeddingReused: profile.cacheHit,
      tenderEmbeddingsReused,
      tenderEmbeddingsCreated,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    return {
      matches,
      businessProfileHash: profile.hash,
      tenderEmbeddingsReused,
      tenderEmbeddingsCreated,
      businessEmbeddingReused: profile.cacheHit
    };
  }

  private async getOrCreateBusinessProfile(profileText: string): Promise<BusinessProfileVector> {
    const metadata = this.embeddingService.metadata;
    const hash = hashText(profileText);
    const id = `profile-${hash}`;
    const key = recordKey("business-profile", id, hash, metadata);
    const existing = this.records.get(key);

    if (existing) {
      return {
        id,
        hash,
        embedding: existing.embedding,
        cacheHit: true
      };
    }

    const embedding = await this.embeddingService.embed(profileText);
    this.records.set(key, {
      id,
      type: "business-profile",
      textHash: hash,
      modelName: metadata.modelName,
      dimensions: embedding.length,
      embedding,
      updatedAt: new Date().toISOString()
    });

    return {
      id,
      hash,
      embedding,
      cacheHit: false
    };
  }

  private async getOrCreateTender(tender: Tender): Promise<IndexedTender> {
    const metadata = this.embeddingService.metadata;
    const tenderText = tenderToSearchText(tender);
    const textHash = hashText(tenderText);
    const key = recordKey("tender", tender.id, textHash, metadata);
    const existing = this.records.get(key);

    if (existing) {
      if (JSON.stringify(existing.tender) !== JSON.stringify(tender)) {
        this.records.set(key, {
          ...existing,
          tender,
          updatedAt: new Date().toISOString()
        });
      }

      return {
        tender,
        textHash,
        cacheHit: true
      };
    }

    const embedding = await this.embeddingService.embed(tenderText);

    this.records.set(key, {
      id: tender.id,
      type: "tender",
      textHash,
      modelName: metadata.modelName,
      dimensions: embedding.length,
      embedding,
      updatedAt: new Date().toISOString(),
      tender
    });

    return {
      tender,
      textHash,
      cacheHit: false
    };
  }

  private async load(): Promise<void> {
    if (this.hasLoaded) {
      return;
    }

    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedVectorStore;

      for (const record of parsed.records ?? []) {
        const key = recordKey(record.type, record.id, record.textHash, record);
        this.records.set(key, record);
      }

      logInfo("Vector store loaded", {
        storePath: this.storePath,
        records: this.records.size
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
        throw error;
      }

      logInfo("Vector store initialized", {
        storePath: this.storePath,
        records: 0
      });
    }

    this.hasLoaded = true;
  }

  private async persist(): Promise<void> {
    const payload: PersistedVectorStore = {
      version: 1,
      records: [...this.records.values()]
    };
    const tempPath = `${this.storePath}.tmp`;

    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(tempPath, JSON.stringify(payload), "utf8");
    await rename(tempPath, this.storePath);

    logInfo("Vector store persisted", {
      storePath: this.storePath,
      records: payload.records.length
    });
  }
}
