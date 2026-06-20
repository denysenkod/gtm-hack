import { Router } from "express";
import { z } from "zod";
import type { SearchResponse } from "../../../shared/tender.js";
import { compareIsoDates } from "../utils/dates.js";
import { extractKeyTerms } from "../utils/text.js";
import { FindTenderClient } from "../clients/findTenderClient.js";

const requestSchema = z.object({
  businessSpecification: z.string().trim().min(20).max(12000)
});

const router = Router();
const client = new FindTenderClient();

router.post("/", async (request, response) => {
  const parsed = requestSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Please provide a businessSpecification between 20 and 12,000 characters."
    });
    return;
  }

  const queryTerms = extractKeyTerms(parsed.data.businessSpecification);

  if (queryTerms.length === 0) {
    response.status(400).json({
      error: "Please include enough descriptive words to create a tender search query."
    });
    return;
  }

  const result = await client.search(queryTerms);
  const payload: SearchResponse = {
    queryTerms,
    source: result.source,
    tenders: result.tenders
      .filter((tender) => tender.status === "active")
      .sort((left, right) => compareIsoDates(left.deadlineDate, right.deadlineDate)),
    warnings: result.warnings
  };

  response.json(payload);
});

export default router;
