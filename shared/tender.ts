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

export interface SearchResponse {
  queryTerms: string[];
  source: "find-a-tender" | "mock";
  tenders: Tender[];
  warnings: string[];
}
