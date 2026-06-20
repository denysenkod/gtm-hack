export interface Tender {
  id: string;
  title: string;
  buyerName: string;
  description: string;
  value: number;
  currency: string;
  publicationDate: string;
  deadlineDate: string;
  documentationUrls: string[];
  status: "active" | "closed";
}

export interface TenderMatch extends Tender {
  matchScore: number;
  matchQuality: "high" | "medium" | "low";
  embeddingStatus: "pending" | "ready" | "failed";
}

export interface SearchProgress {
  total: number;
  completed: number;
  pending: number;
  tenderEmbeddingsReused: number;
  tenderEmbeddingsCreated: number;
  businessEmbeddingReused: boolean | null;
  isBusinessEmbeddingReady: boolean;
}

export interface SearchResponse {
  searchId: string;
  status: "processing" | "complete" | "failed";
  queryTerms: string[];
  businessProfileHash: string;
  source: "find-a-tender" | "mock";
  tenders: TenderMatch[];
  warnings: string[];
  progress: SearchProgress;
}
