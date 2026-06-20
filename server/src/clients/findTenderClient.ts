import type { Tender } from "../../../shared/tender.js";
import { mockFindTenderResponse } from "../data/mockFindTenderResponse.js";
import { ProcurementApiError } from "../errors.js";
import type { OcdsReleasePackage } from "../types/ocds.js";
import { addDays, toIsoDateTimeSeconds } from "../utils/dates.js";
import { scoreTextAgainstTerms } from "../utils/text.js";
import { normalizeOcdsReleases } from "../normalizers/ocds.js";

export interface TenderSearchResult {
  source: "find-a-tender" | "mock";
  tenders: Tender[];
  warnings: string[];
}

interface FindTenderClientOptions {
  baseUrl: string;
  timeoutMs: number;
  lookbackDays: number;
  pageLimit: number;
  maxPages: number;
  useMock?: boolean;
}

const DEFAULT_OPTIONS: FindTenderClientOptions = {
  baseUrl: "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages",
  timeoutMs: 8000,
  lookbackDays: 120,
  pageLimit: 100,
  maxPages: 2
};

function readBooleanEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function readNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createOptionsFromEnv(): FindTenderClientOptions {
  return {
    ...DEFAULT_OPTIONS,
    baseUrl: process.env.FIND_TENDER_BASE_URL ?? DEFAULT_OPTIONS.baseUrl,
    timeoutMs: readNumberEnv(process.env.PROCUREMENT_API_TIMEOUT_MS, DEFAULT_OPTIONS.timeoutMs),
    lookbackDays: readNumberEnv(process.env.FIND_TENDER_LOOKBACK_DAYS, DEFAULT_OPTIONS.lookbackDays),
    pageLimit: readNumberEnv(process.env.FIND_TENDER_PAGE_LIMIT, DEFAULT_OPTIONS.pageLimit),
    maxPages: readNumberEnv(process.env.FIND_TENDER_MAX_PAGES, DEFAULT_OPTIONS.maxPages),
    useMock: readBooleanEnv(process.env.USE_MOCK_PROCUREMENT_API)
  };
}

function buildInitialUrl(options: FindTenderClientOptions): URL {
  const url = new URL(options.baseUrl);
  const updatedTo = new Date();
  const updatedFrom = addDays(updatedTo, -options.lookbackDays);

  url.searchParams.set("updatedFrom", toIsoDateTimeSeconds(updatedFrom));
  url.searchParams.set("updatedTo", toIsoDateTimeSeconds(updatedTo));
  url.searchParams.set("stages", "tender");
  url.searchParams.set("limit", String(options.pageLimit));

  return url;
}

async function fetchJsonWithTimeout(url: URL, timeoutMs: number): Promise<OcdsReleasePackage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "gtm-hack-tender-discovery/0.1"
      },
      signal: controller.signal
    });

    if (response.status === 429) {
      throw new ProcurementApiError("The procurement API rate limit was reached.", 429, true);
    }

    if (!response.ok) {
      throw new ProcurementApiError(
        `The procurement API returned HTTP ${response.status}.`,
        response.status,
        response.status >= 500
      );
    }

    return (await response.json()) as OcdsReleasePackage;
  } catch (error) {
    if (error instanceof ProcurementApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ProcurementApiError("The procurement API request timed out.", 504, true);
    }

    throw new ProcurementApiError("The procurement API request failed.", 502, true);
  } finally {
    clearTimeout(timeout);
  }
}

function scoreTender(tender: Tender, terms: string[]): number {
  const searchableText = [
    tender.title,
    tender.buyerName,
    tender.description,
    tender.documentationUrls.join(" ")
  ].join("\n");

  return scoreTextAgainstTerms(searchableText, terms);
}

function filterAndRankTenders(tenders: Tender[], terms: string[]): Tender[] {
  const ranked = tenders
    .map((tender) => ({
      tender,
      score: scoreTender(tender, terms)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return Date.parse(left.tender.deadlineDate) - Date.parse(right.tender.deadlineDate);
    });

  return ranked.map(({ tender }) => tender);
}

function normalizePackage(response: OcdsReleasePackage, terms: string[]): Tender[] {
  return filterAndRankTenders(normalizeOcdsReleases(response.releases ?? []), terms);
}

async function fetchReleasePackages(options: FindTenderClientOptions): Promise<OcdsReleasePackage[]> {
  const packages: OcdsReleasePackage[] = [];
  let nextUrl: URL | null = buildInitialUrl(options);

  for (let page = 0; page < options.maxPages && nextUrl; page += 1) {
    const releasePackage = await fetchJsonWithTimeout(nextUrl, options.timeoutMs);
    packages.push(releasePackage);

    nextUrl = releasePackage.links?.next ? new URL(releasePackage.links.next) : null;
  }

  return packages;
}

export class FindTenderClient {
  private readonly options: FindTenderClientOptions;

  constructor(options: FindTenderClientOptions = createOptionsFromEnv()) {
    this.options = options;
  }

  async search(terms: string[]): Promise<TenderSearchResult> {
    if (this.options.useMock) {
      return {
        source: "mock",
        tenders: normalizePackage(mockFindTenderResponse, terms),
        warnings: ["Using mock procurement data because USE_MOCK_PROCUREMENT_API is enabled."]
      };
    }

    try {
      const releasePackages = await fetchReleasePackages(this.options);
      const tenders = releasePackages.flatMap((releasePackage) => normalizePackage(releasePackage, terms));

      return {
        source: "find-a-tender",
        tenders,
        warnings:
          tenders.length > 0
            ? []
            : [
                "The live source returned records, but none matched the extracted terms. Try adding sector, buyer, technology, and delivery keywords."
              ]
      };
    } catch (error) {
      const message =
        error instanceof ProcurementApiError
          ? error.message
          : "The live procurement source was unavailable.";

      return {
        source: "mock",
        tenders: normalizePackage(mockFindTenderResponse, terms),
        warnings: [`${message} Showing typed mock data with the same OCDS shape.`]
      };
    }
  }
}
