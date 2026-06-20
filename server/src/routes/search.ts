import { Router } from "express";
import { z } from "zod";
import type { SearchResponse } from "../../../shared/tender.js";
import { extractKeyTerms } from "../utils/text.js";
import { FindTenderClient } from "../clients/findTenderClient.js";
import { EmbeddingService } from "../services/embeddingService.js";
import { SearchJobManager } from "../services/searchJobManager.js";
import { VectorStore } from "../services/vectorStore.js";
import { logInfo } from "../utils/logger.js";

const requestSchema = z.object({
  businessSpecification: z.string().trim().min(20).max(12000)
});

const router = Router();
const client = new FindTenderClient();
const embeddings = new EmbeddingService();
const vectorStore = new VectorStore(embeddings);
const searchJobs = new SearchJobManager(vectorStore);

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

  const payload: SearchResponse = searchJobs.create({
    queryTerms,
    source: result.source,
    tenders: activeTenders,
    businessSpecification: parsed.data.businessSpecification,
    sourceWarnings: result.warnings
  });

  logInfo("Tender search job response ready", {
    searchId: payload.searchId,
    source: payload.source,
    matches: payload.tenders.length,
    elapsedMs: Math.round(performance.now() - startedAt)
  });

  response.json(payload);
});

router.get("/:searchId", (request, response) => {
  const payload = searchJobs.get(request.params.searchId);

  if (!payload) {
    response.status(404).json({
      error: "Search job not found."
    });
    return;
  }

  response.json(payload);
});

export default router;
