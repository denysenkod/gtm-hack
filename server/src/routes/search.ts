import { Router } from "express";
import { z } from "zod";
import type { SearchResponse } from "../../../shared/tender.js";
import { extractKeyTerms } from "../utils/text.js";
import { FindTenderClient } from "../clients/findTenderClient.js";
import { EmbeddingService } from "../services/embeddingService.js";
import { VectorStore } from "../services/vectorStore.js";
import { logInfo } from "../utils/logger.js";

const requestSchema = z.object({
  businessSpecification: z.string().trim().min(20).max(12000)
});

const router = Router();
const client = new FindTenderClient();
const embeddings = new EmbeddingService();
const vectorStore = new VectorStore(embeddings);

router.post("/", async (request, response) => {
  const startedAt = performance.now();
  const parsed = requestSchema.safeParse(request.body);

  if (!parsed.success) {
    logInfo("Tender search rejected", {
      reason: "invalid-business-specification"
    });
    response.status(400).json({
      error: "Please provide a businessSpecification between 20 and 12,000 characters."
    });
    return;
  }

  const queryTerms = extractKeyTerms(parsed.data.businessSpecification);

  if (queryTerms.length === 0) {
    logInfo("Tender search rejected", {
      reason: "no-query-terms"
    });
    response.status(400).json({
      error: "Please include enough descriptive words to create a tender search query."
    });
    return;
  }

  logInfo("Tender search requested", {
    businessSpecificationLength: parsed.data.businessSpecification.length,
    queryTerms: queryTerms.join(", ")
  });

  const result = await client.search();
  const activeTenders = result.tenders.filter((tender) => tender.status === "active");
  logInfo("Procurement candidates fetched", {
    source: result.source,
    totalCandidates: result.tenders.length,
    activeCandidates: activeTenders.length,
    warnings: result.warnings.length
  });

  const vectorResult = await vectorStore.indexAndSearch(parsed.data.businessSpecification, activeTenders);
  const cacheSummary = [
    vectorResult.businessEmbeddingReused
      ? "Reused cached embedding for unchanged business profile."
      : "Generated a new embedding for the changed business profile.",
    `Tender embeddings reused: ${vectorResult.tenderEmbeddingsReused}; created: ${vectorResult.tenderEmbeddingsCreated}.`
  ];

  const payload: SearchResponse = {
    queryTerms,
    businessProfileHash: vectorResult.businessProfileHash,
    source: result.source,
    tenders: vectorResult.matches,
    warnings: [...result.warnings, ...cacheSummary]
  };

  logInfo("Tender search response ready", {
    source: payload.source,
    matches: payload.tenders.length,
    topTenderId: payload.tenders[0]?.id,
    topMatchScore: payload.tenders[0]?.matchScore,
    elapsedMs: Math.round(performance.now() - startedAt)
  });

  response.json(payload);
});

export default router;
