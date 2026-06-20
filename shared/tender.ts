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
}

export interface SearchResponse {
  queryTerms: string[];
  businessProfileHash: string;
  source: "find-a-tender" | "mock";
  tenders: TenderMatch[];
  warnings: string[];
}
