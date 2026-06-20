import { Agent } from "agents";
import { z } from "zod";

type TenderDecision = "bid" | "maybe" | "skip";

interface AgentEnv {
  AI: Ai;
  TENDER_INTEL_LLM_MODEL?: string;
  PROZORRO_BASE_URL?: string;
  PROZORRO_FEED_PAGES?: string;
  PROZORRO_FEED_LIMIT?: string;
}

interface BusinessProfile {
  companySummary: string;
  capabilities: string[];
  industries: string[];
  geography: string[];
  excludedWork: string[];
  projectSizeHint: string;
}

interface ProcurementFilters {
  cpvPrefixes: string[];
  keywordsUk: string[];
  negativeKeywordsUk: string[];
  minValueUah: number;
  rationale: string;
}

interface TenderIntelMatch {
  id: string;
  tenderId: string;
  title: string;
  buyerName: string;
  value: number;
  currency: string;
  deadlineDate: string;
  cpvCodes: string[];
  matchedBuckets: string[];
  matchedKeywords: string[];
  negativeKeywords: string[];
  score: number;
  decision: TenderDecision;
  whyRelevant: string;
  risks: string[];
  url: string;
}

interface TenderIntelState {
  companyWebsite?: string;
  linkedinUrl?: string;
  businessProfile?: BusinessProfile;
  filters?: ProcurementFilters;
  lastMatches: TenderIntelMatch[];
  lastSearchAt?: string;
  lastError?: string;
}

interface ProzorroFeedRow {
  id: string;
  status?: string;
  dateModified?: string;
}

interface ProzorroTender {
  id: string;
  tenderID?: string;
  title?: string;
  description?: string;
  status?: string;
  value?: {
    amount?: number;
    currency?: string;
  };
  tenderPeriod?: {
    endDate?: string;
  };
  dateModified?: string;
  procuringEntity?: {
    name?: string;
  };
  items?: Array<{
    description?: string;
    classification?: {
      id?: string;
      description?: string;
    };
  }>;
}

const onboardSchema = z.object({
  companyWebsite: z.string().trim().url().max(2048),
  linkedinUrl: z.string().trim().url().max(2048),
  minValueUah: z.number().positive().optional()
});

const searchSchema = z.object({
  minValueUah: z.number().positive().optional(),
  maxPages: z.number().int().positive().max(30).optional()
});

const DEFAULT_PROZORRO_BASE_URL = "https://public-api.prozorro.gov.ua/api/2.5";
const DEFAULT_FEED_PAGES = 8;
const DEFAULT_FEED_LIMIT = 100;
const DEFAULT_MIN_VALUE_UAH = 300_000;
const DEFAULT_LLM_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const INDUSTRIAL_CPV_BUCKETS: Array<{ name: string; prefixes: string[]; weight: number }> = [
  { name: "core machine and line installation", prefixes: ["515", "511", "512", "513", "514", "516"], weight: 35 },
  { name: "electrical and industrial installation", prefixes: ["4531", "4535"], weight: 25 },
  { name: "machinery repair and maintenance", prefixes: ["505", "507"], weight: 20 },
  { name: "engineering and design", prefixes: ["7132", "7125"], weight: 15 },
  { name: "industrial construction and repair", prefixes: ["4521", "4525", "4526", "4545"], weight: 10 },
  { name: "cargo handling and special transport", prefixes: ["631", "6018"], weight: 10 }
];

const DEFAULT_POSITIVE_KEYWORDS = [
  "монтаж",
  "демонтаж",
  "переміщ",
  "релокац",
  "ліні",
  "виробнич",
  "технологіч",
  "обладнан",
  "устаткуван",
  "машин",
  "електромонтаж",
  "електр",
  "автоматизац",
  "щит",
  "трансформатор",
  "пусконалагод",
  "цех",
  "промисл",
  "котельн",
  "насос",
  "ремонт",
  "реконструкц",
  "завантаж",
  "розвантаж",
  "пакуван",
  "вантаж"
];

const DEFAULT_NEGATIVE_KEYWORDS = [
  "харчування",
  "продукти",
  "паливо",
  "вугілля",
  "дрони",
  "медичн",
  "лікарськ",
  "автомобіл",
  "шини",
  "канцеляр",
  "одяг"
];

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compactText(text: string): string {
  return text.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "TenderIntelAgent/0.1"
      }
    });

    if (!response.ok) {
      return "";
    }

    return compactText(await response.text());
  } catch {
    return "";
  }
}

function extractJsonObject(text: string): unknown | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function fallbackBusinessProfile(companyWebsite: string): BusinessProfile {
  return {
    companySummary: `Industrial contractor inferred from ${companyWebsite}.`,
    capabilities: [
      "machine relocation",
      "production-line relocation",
      "industrial assembly and disassembly",
      "industrial construction",
      "electrical and automation work",
      "oversized loading and packing"
    ],
    industries: ["industrial manufacturing", "construction", "energy", "utilities"],
    geography: ["Ukraine", "Poland", "EU"],
    excludedWork: ["retail goods supply", "medical goods", "office supplies"],
    projectSizeHint: "Prefer serious works and services contracts above 300000 UAH."
  };
}

async function profileBusiness(input: { companyWebsite: string; linkedinUrl: string }, env: AgentEnv): Promise<BusinessProfile> {
  const [websiteText, linkedinText] = await Promise.all([
    fetchPageText(input.companyWebsite),
    fetchPageText(input.linkedinUrl)
  ]);
  const fallback = fallbackBusinessProfile(input.companyWebsite);

  if (!websiteText && !linkedinText) {
    return fallback;
  }

  try {
    const response = await env.AI.run((env.TENDER_INTEL_LLM_MODEL ?? DEFAULT_LLM_MODEL) as never, {
      messages: [
        {
          role: "system",
          content:
            "Extract a procurement-search business profile. Return only JSON with keys: companySummary, capabilities, industries, geography, excludedWork, projectSizeHint."
        },
        {
          role: "user",
          content: JSON.stringify({
            companyWebsite: input.companyWebsite,
            linkedinUrl: input.linkedinUrl,
            websiteText,
            linkedinText
          })
        }
      ]
    } as never);
    const text = typeof response === "string" ? response : JSON.stringify(response);
    const parsed = extractJsonObject(text) as Partial<BusinessProfile> | null;

    return {
      companySummary: parsed?.companySummary || fallback.companySummary,
      capabilities: Array.isArray(parsed?.capabilities) ? parsed.capabilities.map(String).slice(0, 12) : fallback.capabilities,
      industries: Array.isArray(parsed?.industries) ? parsed.industries.map(String).slice(0, 8) : fallback.industries,
      geography: Array.isArray(parsed?.geography) ? parsed.geography.map(String).slice(0, 8) : fallback.geography,
      excludedWork: Array.isArray(parsed?.excludedWork) ? parsed.excludedWork.map(String).slice(0, 10) : fallback.excludedWork,
      projectSizeHint: parsed?.projectSizeHint || fallback.projectSizeHint
    };
  } catch {
    return fallback;
  }
}

function mapProfileToFilters(profile: BusinessProfile, minValueUah?: number): ProcurementFilters {
  const profileText = [
    profile.companySummary,
    ...profile.capabilities,
    ...profile.industries,
    profile.projectSizeHint
  ].join(" ").toLowerCase();
  const buckets = INDUSTRIAL_CPV_BUCKETS.filter((bucket) => {
    if (bucket.name.includes("installation")) {
      return /install|монтаж|assembly|relocation|line|machine/.test(profileText);
    }

    if (bucket.name.includes("electrical")) {
      return /electr|automat|automation|електр|автомат/.test(profileText);
    }

    if (bucket.name.includes("repair")) {
      return /repair|maintenance|service|ремонт|обслугов/.test(profileText);
    }

    if (bucket.name.includes("engineering")) {
      return /engineer|design|project|turnkey|проект/.test(profileText);
    }

    if (bucket.name.includes("construction")) {
      return /construction|building|industrial|будів|реконструк/.test(profileText);
    }

    if (bucket.name.includes("cargo")) {
      return /cargo|transport|oversized|loading|packing|вантаж|пакув/.test(profileText);
    }

    return false;
  });
  const selectedBuckets = buckets.length > 0 ? buckets : INDUSTRIAL_CPV_BUCKETS;

  return {
    cpvPrefixes: [...new Set(selectedBuckets.flatMap((bucket) => bucket.prefixes))],
    keywordsUk: DEFAULT_POSITIVE_KEYWORDS,
    negativeKeywordsUk: DEFAULT_NEGATIVE_KEYWORDS,
    minValueUah: minValueUah ?? DEFAULT_MIN_VALUE_UAH,
    rationale: "Mapped company capabilities to CPV prefixes first, then Ukrainian semantic stems and false-positive penalties."
  };
}

function tenderUrl(tender: ProzorroTender): string {
  return `https://prozorro.gov.ua/tender/${tender.tenderID || tender.id}`;
}

function cpvMatchesPrefix(cpvCode: string, prefixes: string[]): boolean {
  const normalizedCode = cpvCode.replace(/[^0-9]/g, "");

  return prefixes.some((prefix) => normalizedCode.startsWith(prefix.replace(/[^0-9]/g, "")));
}

function bucketForCpv(cpvCode: string): Array<{ name: string; weight: number }> {
  return INDUSTRIAL_CPV_BUCKETS.filter((bucket) => cpvMatchesPrefix(cpvCode, bucket.prefixes)).map((bucket) => ({
    name: bucket.name,
    weight: bucket.weight
  }));
}

function scoreTender(tender: ProzorroTender, filters: ProcurementFilters): TenderIntelMatch | null {
  const items = tender.items ?? [];
  const cpvCodes = items.map((item) => item.classification?.id).filter((value): value is string => Boolean(value));
  const title = tender.title ?? "Untitled tender";
  const searchableText = [
    title,
    tender.description ?? "",
    ...items.map((item) => `${item.description ?? ""} ${item.classification?.description ?? ""}`)
  ].join(" ").toLowerCase();
  const matchedBuckets = cpvCodes.flatMap(bucketForCpv);
  const matchedKeywords = filters.keywordsUk.filter((keyword) => searchableText.includes(keyword.toLowerCase()));
  const negativeKeywords = filters.negativeKeywordsUk.filter((keyword) => searchableText.includes(keyword.toLowerCase()));
  const value = tender.value?.amount ?? 0;

  if (tender.status !== "active.tendering") {
    return null;
  }

  if (value > 0 && value < filters.minValueUah) {
    return null;
  }

  if (matchedBuckets.length === 0 && matchedKeywords.length < 2) {
    return null;
  }

  const uniqueBucketNames = [...new Set(matchedBuckets.map((bucket) => bucket.name))];
  const bucketScore = matchedBuckets.length > 0 ? 45 + Math.max(...matchedBuckets.map((bucket) => bucket.weight)) : 0;
  const keywordScore = Math.min(25, matchedKeywords.length * 5);
  const valueScore = (value >= filters.minValueUah ? 10 : 0) + (value >= 2_000_000 ? 10 : 0);
  const negativePenalty = Math.min(25, negativeKeywords.length * 6);
  const score = Math.max(0, Math.min(100, bucketScore + keywordScore + valueScore - negativePenalty));
  const decision: TenderDecision = score >= 75 ? "bid" : score >= 50 ? "maybe" : "skip";

  return {
    id: tender.id,
    tenderId: tender.tenderID ?? tender.id,
    title,
    buyerName: tender.procuringEntity?.name ?? "Unknown buyer",
    value,
    currency: tender.value?.currency ?? "UAH",
    deadlineDate: tender.tenderPeriod?.endDate ?? "",
    cpvCodes,
    matchedBuckets: uniqueBucketNames,
    matchedKeywords,
    negativeKeywords,
    score,
    decision,
    whyRelevant:
      uniqueBucketNames.length > 0
        ? `CPV match: ${uniqueBucketNames.join(", ")}.`
        : `Semantic match through Ukrainian stems: ${matchedKeywords.join(", ")}.`,
    risks: negativeKeywords.length > 0 ? [`Possible false-positive terms: ${negativeKeywords.join(", ")}.`] : [],
    url: tenderUrl(tender)
  };
}

function withoutLastError(state: TenderIntelState): TenderIntelState {
  const { lastError: _lastError, ...rest } = state;

  return rest;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "TenderIntelAgent/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchActiveProzorroTenders(env: AgentEnv, maxPages?: number): Promise<ProzorroTender[]> {
  const baseUrl = env.PROZORRO_BASE_URL ?? DEFAULT_PROZORRO_BASE_URL;
  const limit = readNumber(env.PROZORRO_FEED_LIMIT, DEFAULT_FEED_LIMIT);
  const pages = maxPages ?? readNumber(env.PROZORRO_FEED_PAGES, DEFAULT_FEED_PAGES);
  let url = `${baseUrl}/tenders?descending=1&limit=${limit}&opt_fields=status`;
  const activeIds: string[] = [];

  for (let page = 0; page < pages && url; page += 1) {
    const payload = await fetchJson<{
      data?: ProzorroFeedRow[];
      next_page?: {
        uri?: string;
      };
    }>(url);
    activeIds.push(...(payload.data ?? []).filter((row) => row.status === "active.tendering").map((row) => row.id));
    url = payload.next_page?.uri ?? "";
  }

  const detailResults = await Promise.allSettled(
    activeIds.map((id) => fetchJson<{ data: ProzorroTender }>(`${baseUrl}/tenders/${id}`).then((payload) => payload.data))
  );

  return detailResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export class TenderIntelAgent extends Agent<AgentEnv, TenderIntelState> {
  initialState: TenderIntelState = {
    lastMatches: []
  };

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).at(-1);

    if (request.method === "GET" && action === "state") {
      return jsonResponse(this.state);
    }

    if (request.method === "GET" && action === "matches") {
      return jsonResponse({
        matches: this.state.lastMatches,
        lastSearchAt: this.state.lastSearchAt,
        filters: this.state.filters
      });
    }

    if (request.method === "POST" && action === "onboard") {
      const parsed = onboardSchema.safeParse(await request.json().catch(() => null));

      if (!parsed.success) {
        return jsonResponse({ error: "Provide companyWebsite, linkedinUrl, and optional minValueUah." }, { status: 400 });
      }

      const businessProfile = await profileBusiness(parsed.data, this.env);
      const filters = mapProfileToFilters(businessProfile, parsed.data.minValueUah);
      this.setState({
        ...withoutLastError(this.state),
        companyWebsite: parsed.data.companyWebsite,
        linkedinUrl: parsed.data.linkedinUrl,
        businessProfile,
        filters
      });

      return jsonResponse({
        businessProfile,
        filters
      });
    }

    if (request.method === "POST" && action === "search") {
      const parsed = searchSchema.safeParse(await request.json().catch(() => ({})));
      const nextFilters = this.state.filters
        ? {
            ...this.state.filters,
            ...(parsed.success && parsed.data.minValueUah ? { minValueUah: parsed.data.minValueUah } : {})
          }
        : mapProfileToFilters(this.state.businessProfile ?? fallbackBusinessProfile(this.state.companyWebsite ?? "unknown"), parsed.success ? parsed.data.minValueUah : undefined);

      try {
        const tenders = await fetchActiveProzorroTenders(this.env, parsed.success ? parsed.data.maxPages : undefined);
        const matches = tenders
          .map((tender) => scoreTender(tender, nextFilters))
          .filter((match): match is TenderIntelMatch => Boolean(match))
          .sort((left, right) => right.score - left.score || right.value - left.value)
          .slice(0, 25);

        this.setState({
          ...withoutLastError(this.state),
          filters: nextFilters,
          lastMatches: matches,
          lastSearchAt: new Date().toISOString()
        });

        return jsonResponse({
          filters: nextFilters,
          scanned: tenders.length,
          matches
        });
      } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        this.setState({
          ...this.state,
          lastError
        });

        return jsonResponse({ error: lastError }, { status: 502 });
      }
    }

    if (request.method === "POST" && action === "schedule-daily") {
      await this.schedule("0 8 * * *", "runDailySearch", {});

      return jsonResponse({ scheduled: true });
    }

    return jsonResponse({ error: "TenderIntelAgent route not found." }, { status: 404 });
  }

  async runDailySearch(): Promise<void> {
    const filters =
      this.state.filters ??
      mapProfileToFilters(this.state.businessProfile ?? fallbackBusinessProfile(this.state.companyWebsite ?? "unknown"));
    const tenders = await fetchActiveProzorroTenders(this.env);
    const matches = tenders
      .map((tender) => scoreTender(tender, filters))
      .filter((match): match is TenderIntelMatch => Boolean(match))
      .sort((left, right) => right.score - left.score || right.value - left.value)
      .slice(0, 25);

    this.setState({
      ...withoutLastError(this.state),
      filters,
      lastMatches: matches,
      lastSearchAt: new Date().toISOString()
    });
  }
}
