import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SearchResponse, TenderMatch } from "../../shared/tender";

const exampleSpecification =
  "We deliver secure cloud software, workflow automation, CRM integration, data migration, analytics dashboards, and support for public sector health and local government teams.";

type MatchFilter = "all" | "high" | "medium" | "active";
type SortMode = "match" | "value" | "deadline";
type OnboardingStep = 1 | 2;

interface OnboardingProfile {
  companyWebsite: string;
  linkedinUrl: string;
}

const CIRCLE_RADIUS = 20;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;
const PAGE_SIZE = 25;
const ONBOARDING_STORAGE_KEY = "tenderDiscoveryOnboarding";
const BROWSER_SESSION_STORAGE_KEY = "tenderDiscoveryBrowserSessionId";

function readOrCreateBrowserSessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const existingSessionId = window.localStorage.getItem(BROWSER_SESSION_STORAGE_KEY)?.trim();

  if (existingSessionId) {
    return existingSessionId;
  }

  const nextSessionId = window.crypto.randomUUID();
  window.localStorage.setItem(BROWSER_SESSION_STORAGE_KEY, nextSessionId);
  return nextSessionId;
}

function readOnboardingProfile(): OnboardingProfile | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawProfile = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);

    if (!rawProfile) {
      return null;
    }

    const parsed = JSON.parse(rawProfile) as Partial<OnboardingProfile>;
    const companyWebsite = typeof parsed.companyWebsite === "string" ? parsed.companyWebsite.trim() : "";
    const linkedinUrl = typeof parsed.linkedinUrl === "string" ? parsed.linkedinUrl.trim() : "";

    if (!companyWebsite || !linkedinUrl) {
      return null;
    }

    return {
      companyWebsite,
      linkedinUrl
    };
  } catch {
    return null;
  }
}

function buildBusinessSpecificationFromProfile(profile: OnboardingProfile): string {
  return [
    `Company website: ${profile.companyWebsite}`,
    `LinkedIn profile: ${profile.linkedinUrl}`,
    "Use these public sources to infer the company's services, sectors, operating geography, relevant CPV categories, semantic keywords, and value thresholds for procurement matching."
  ].join("\n");
}

async function persistOnboardingProfile(sessionId: string, profile: OnboardingProfile): Promise<void> {
  if (!sessionId) {
    return;
  }

  const response = await fetch("/api/profile", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      browserSessionId: sessionId,
      companyWebsite: profile.companyWebsite,
      linkedinUrl: profile.linkedinUrl
    })
  });

  if (!response.ok) {
    throw new Error("Profile persistence failed.");
  }
}

function normalizeUrlInput(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  return /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
}

function formatCurrency(value: number, currency: string): string {
  if (value <= 0) {
    return "Not disclosed";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return "Not specified";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(parsed));
}

function daysUntil(value: string): number | null {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadline = new Date(parsed);
  deadline.setHours(0, 0, 0, 0);

  return Math.ceil((deadline.getTime() - today.getTime()) / 86_400_000);
}

function deadlineStyles(days: number | null): { label: string; className: string } {
  if (days === null) {
    return {
      label: "Deadline not specified",
      className: "border-[#e1e5e2] bg-[#eef0f1] text-[#525a60]"
    };
  }

  if (days < 0) {
    return {
      label: "Deadline passed",
      className: "border-[#f4cbc6] bg-[#fdeceb] text-[#b42318]"
    };
  }

  if (days <= 14) {
    return {
      label: days === 0 ? "Due today" : `${days} days left`,
      className: "border-[#eedcb2] bg-[#fbf1de] text-[#8a560f]"
    };
  }

  return {
    label: `${days} days left`,
    className: "border-[#c8e3d4] bg-[#e6f2ea] text-[#15643f]"
  };
}

function matchPalette(tender: TenderMatch): {
  label: string;
  shortLabel: string;
  ring: string;
  badgeClassName: string;
} {
  if (tender.embeddingStatus === "pending") {
    return {
      label: "Embedding",
      shortLabel: "PENDING",
      ring: "#909a93",
      badgeClassName: "bg-[#eef0f1] text-[#525a60]"
    };
  }

  if (tender.embeddingStatus === "failed") {
    return {
      label: "Embedding failed",
      shortLabel: "FAILED",
      ring: "#b42318",
      badgeClassName: "bg-[#fdeceb] text-[#b42318]"
    };
  }

  if (tender.matchQuality === "high") {
    return {
      label: "Strong match",
      shortLabel: "STRONG",
      ring: "#1f7a4d",
      badgeClassName: "bg-[#e6f2ea] text-[#15643f]"
    };
  }

  if (tender.matchQuality === "medium") {
    return {
      label: "Possible match",
      shortLabel: "POSSIBLE",
      ring: "#b07315",
      badgeClassName: "bg-[#fbf1de] text-[#8a560f]"
    };
  }

  return {
    label: "Low match",
    shortLabel: "LOW",
    ring: "#909a93",
    badgeClassName: "bg-[#eef0f1] text-[#525a60]"
  };
}

function effectiveEmbeddingStatus(tender: TenderMatch, isEmbedding: boolean): TenderMatch["embeddingStatus"] {
  if (tender.embeddingStatus === "pending" && !isEmbedding) {
    return "failed";
  }

  return tender.embeddingStatus;
}

function matchPercent(tender: TenderMatch): number {
  if (tender.embeddingStatus !== "ready") {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(tender.matchScore * 100)));
}

function matchDisplay(tender: TenderMatch, isEmbedding: boolean): string {
  const status = effectiveEmbeddingStatus(tender, isEmbedding);

  if (status === "pending") {
    return "-";
  }

  if (status === "failed") {
    return "!";
  }

  return String(matchPercent(tender));
}

function compareByDeadline(left: TenderMatch, right: TenderMatch): number {
  const leftTime = Date.parse(left.deadlineDate);
  const rightTime = Date.parse(right.deadlineDate);

  return (Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER);
}

function filterTenders(tenders: TenderMatch[], filter: MatchFilter): TenderMatch[] {
  if (filter === "active") {
    return tenders.filter((tender) => tender.status === "active");
  }

  if (filter === "high" || filter === "medium") {
    return tenders.filter((tender) => tender.embeddingStatus === "ready" && tender.matchQuality === filter);
  }

  return tenders;
}

function sortTenders(tenders: TenderMatch[], sort: SortMode): TenderMatch[] {
  return [...tenders].sort((left, right) => {
    if (sort === "value") {
      return right.value - left.value;
    }

    if (sort === "deadline") {
      return compareByDeadline(left, right);
    }

    if (left.embeddingStatus === "ready" && right.embeddingStatus !== "ready") {
      return -1;
    }

    if (left.embeddingStatus !== "ready" && right.embeddingStatus === "ready") {
      return 1;
    }

    if (right.matchScore !== left.matchScore) {
      return right.matchScore - left.matchScore;
    }

    return compareByDeadline(left, right);
  });
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${
        dark ? "border-[#1f7a4d]" : "border-white"
      }`}
    />
  );
}

function FilterButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
        active
          ? "border-[#1f7a4d] bg-[#1f7a4d] text-white"
          : "border-[#e1e5e2] bg-white text-[#525a60] hover:border-[#c8e3d4] hover:text-[#13201a]"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function MatchRing({ isEmbedding, tender }: { isEmbedding: boolean; tender: TenderMatch }) {
  const effectiveTender = {
    ...tender,
    embeddingStatus: effectiveEmbeddingStatus(tender, isEmbedding)
  };
  const palette = matchPalette(effectiveTender);
  const percent = matchPercent(effectiveTender);
  const dash = CIRCLE_CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div className="relative h-[62px] w-[62px]">
      <svg className="-rotate-90" height="62" viewBox="0 0 56 56" width="62">
        <circle cx="28" cy="28" fill="none" r={CIRCLE_RADIUS} stroke="#edf0ee" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          fill="none"
          r={CIRCLE_RADIUS}
          stroke={palette.ring}
          strokeDasharray={CIRCLE_CIRCUMFERENCE}
          strokeDashoffset={dash}
          strokeLinecap="round"
          strokeWidth="5"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold"
        style={{ color: palette.ring }}
      >
        {effectiveTender.embeddingStatus === "pending" ? <Spinner dark /> : matchDisplay(effectiveTender, isEmbedding)}
      </div>
    </div>
  );
}

function TenderCard({ isEmbedding, tender }: { isEmbedding: boolean; tender: TenderMatch }) {
  const effectiveTender = {
    ...tender,
    embeddingStatus: effectiveEmbeddingStatus(tender, isEmbedding)
  };
  const days = daysUntil(tender.deadlineDate);
  const deadline = deadlineStyles(days);
  const match = matchPalette(effectiveTender);

  return (
    <details className="group rounded-2xl border border-[#e4e7e5] bg-white px-6 py-5 shadow-[0_1px_2px_rgba(16,28,22,0.04)] transition hover:border-[#cfe0d6] hover:shadow-[0_4px_16px_rgba(16,28,22,0.07)]">
      <summary className="grid cursor-pointer list-none gap-5 md:grid-cols-[minmax(0,1fr)_172px] md:gap-7">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[#e1e5e2] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#6a746e]">
              {tender.status}
            </span>
            <span className={`rounded-md border px-2.5 py-1 text-[11.5px] font-semibold ${deadline.className}`}>
              {deadline.label}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-bold ${match.badgeClassName}`}
            >
              {effectiveTender.embeddingStatus === "pending" ? <Spinner dark /> : null}
              {match.label}
            </span>
          </div>

          <h2 className="m-0 text-[19px] font-bold leading-snug text-[#13201a]">{tender.title}</h2>
          <div className="mt-2 text-[13.5px] font-semibold text-[#1f7a4d]">{tender.buyerName}</div>
          <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-[#5c655f]">{tender.description}</p>
        </div>

        <div className="border-t border-[#eef1ef] pt-5 text-left md:border-l md:border-t-0 md:pl-6 md:pt-0 md:text-right">
          <div className="flex flex-col items-start md:items-end">
            <MatchRing isEmbedding={isEmbedding} tender={effectiveTender} />
            <div className="mt-1.5 text-[11px] tracking-[0.02em] text-[#8a938c]">match quality</div>
            <div className="mt-5 text-[11px] uppercase tracking-[0.04em] text-[#8a938c]">Estimated value</div>
            <div className="mt-1 text-[17px] font-extrabold text-[#13201a]">
              {formatCurrency(tender.value, tender.currency)}
            </div>
            <div className="mt-2.5 text-xs text-[#8a938c]">Closes {formatDate(tender.deadlineDate)}</div>
          </div>
        </div>
      </summary>

      <div className="mt-5 border-t border-[#eef1ef] pt-5">
        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold text-[#6a746e]">Publication date</dt>
            <dd className="mt-1 text-[#13201a]">{formatDate(tender.publicationDate)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#6a746e]">Deadline date</dt>
            <dd className="mt-1 text-[#13201a]">{formatDate(tender.deadlineDate)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#6a746e]">Cosine match score</dt>
            <dd className="mt-1 text-[#13201a]">
              {effectiveTender.embeddingStatus === "ready" ? `${matchPercent(effectiveTender)}%` : "- (0%)"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[#6a746e]">Embedding status</dt>
            <dd className="mt-1 capitalize text-[#13201a]">{effectiveTender.embeddingStatus}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#6a746e]">Buyer</dt>
            <dd className="mt-1 text-[#13201a]">{tender.buyerName}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#6a746e]">Tender ID</dt>
            <dd className="mt-1 break-all text-[#13201a]">{tender.id}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-[#6a746e]">Documentation</h3>
          {tender.documentationUrls.length > 0 ? (
            <ul className="mt-2 grid gap-2">
              {tender.documentationUrls.map((url) => (
                <li key={url}>
                  <a
                    className="inline-flex max-w-full rounded-lg border border-[#e1e5e2] px-3 py-2 text-sm font-semibold text-[#1f7a4d] transition hover:border-[#c8e3d4] hover:bg-[#eef4f0]"
                    href={url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="truncate">{url}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[#5c655f]">No direct documentation links were published.</p>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-[#6a746e]">Complete scope text</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#5c655f]">{tender.description}</p>
        </div>
      </div>
    </details>
  );
}

function OnboardingProgress({ currentStep }: { currentStep: OnboardingStep }) {
  return (
    <div aria-label="Onboarding progress" className="fixed inset-x-0 bottom-8 flex justify-center">
      <div className="flex items-center gap-3">
        {[1, 2].map((step) => {
          const isComplete = step < currentStep;
          const isCurrent = step === currentStep;

          return (
            <div className="flex items-center gap-3" key={step}>
              {step > 1 ? <div className="h-px w-10 bg-[#cfd6d2]" /> : null}
              <div
                aria-current={isCurrent ? "step" : undefined}
                className={`grid h-10 w-10 place-items-center rounded-full border text-sm font-extrabold transition ${
                  isComplete
                    ? "border-[#1f7a4d] bg-[#1f7a4d] text-white"
                    : isCurrent
                      ? "border-[#13201a] bg-white text-[#13201a] shadow-[0_0_0_5px_rgba(31,122,77,0.13)]"
                      : "border-[#cfd6d2] bg-white text-[#7a847e]"
                }`}
              >
                {step}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const savedProfile = useMemo(() => readOnboardingProfile(), []);
  const [browserSessionId] = useState(() => readOrCreateBrowserSessionId());
  const [companyWebsite, setCompanyWebsite] = useState(savedProfile?.companyWebsite ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(savedProfile?.linkedinUrl ?? "");
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(1);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(Boolean(savedProfile));
  const [businessSpecification, setBusinessSpecification] = useState(() =>
    savedProfile ? buildBusinessSpecificationFromProfile(savedProfile) : ""
  );
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [sort, setSort] = useState<SortMode>("match");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [hideExpired, setHideExpired] = useState(false);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);

  const filteredAndSortedTenders = useMemo(() => {
    const unexpiredTenders = hideExpired
      ? (results?.tenders ?? []).filter((tender) => {
          const days = daysUntil(tender.deadlineDate);

          return days === null || days >= 0;
        })
      : (results?.tenders ?? []);

    return sortTenders(filterTenders(unexpiredTenders, filter), sort);
  }, [filter, hideExpired, results, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedTenders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rankedTenders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;

    return filteredAndSortedTenders.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredAndSortedTenders]);

  const counts = useMemo(() => {
    const tenders = results?.tenders ?? [];

    return {
      all: tenders.length,
      high: tenders.filter((tender) => tender.embeddingStatus === "ready" && tender.matchQuality === "high").length,
      medium: tenders.filter((tender) => tender.embeddingStatus === "ready" && tender.matchQuality === "medium")
        .length,
      active: tenders.filter((tender) => tender.status === "active").length
    };
  }, [results]);

  const isEmbedding = results?.status === "processing";
  const strongCount = counts.high;

  function completeOnboarding(profile: OnboardingProfile): void {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(profile));
    setBusinessSpecification(buildBusinessSpecificationFromProfile(profile));
    setHasCompletedOnboarding(true);
    void persistOnboardingProfile(browserSessionId, profile).catch((profileError: unknown) => {
      console.warn(profileError instanceof Error ? profileError.message : "Profile persistence failed.");
    });
  }

  useEffect(() => {
    if (!savedProfile) {
      return;
    }

    void persistOnboardingProfile(browserSessionId, savedProfile).catch((profileError: unknown) => {
      console.warn(profileError instanceof Error ? profileError.message : "Profile persistence failed.");
    });
  }, [browserSessionId, savedProfile]);

  function handleWebsiteSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const normalizedWebsite = normalizeUrlInput(companyWebsite);

    if (!normalizedWebsite) {
      return;
    }

    setCompanyWebsite(normalizedWebsite);
    setOnboardingStep(2);
  }

  function handleLinkedinSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const normalizedWebsite = normalizeUrlInput(companyWebsite);
    const normalizedLinkedinUrl = normalizeUrlInput(linkedinUrl);

    if (!normalizedWebsite || !normalizedLinkedinUrl) {
      return;
    }

    setCompanyWebsite(normalizedWebsite);
    setLinkedinUrl(normalizedLinkedinUrl);
    completeOnboarding({
      companyWebsite: normalizedWebsite,
      linkedinUrl: normalizedLinkedinUrl
    });
  }

  useEffect(() => {
    setPage(1);
  }, [filter, hideExpired, results?.searchId, sort]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  function scrollResultsToTop(): void {
    resultsTopRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function changePage(nextPage: number): void {
    const boundedPage = Math.min(Math.max(nextPage, 1), totalPages);

    setPage(boundedPage);
    window.setTimeout(scrollResultsToTop, 0);
  }

  function handlePageInputSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const parsed = Number(pageInput);

    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage));
      return;
    }

    changePage(Math.trunc(parsed));
  }

  useEffect(() => {
    if (!results || results.status !== "processing") {
      return;
    }

    let isCancelled = false;
    const { searchId } = results;

    async function pollSearch() {
      try {
        const response = await fetch(`/api/search/${searchId}`);
        const payload = (await response.json()) as SearchResponse | { error?: string };

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "Search update failed.");
        }

        if (!isCancelled) {
          setResults(payload as SearchResponse);
        }
      } catch (pollError) {
        if (!isCancelled) {
          setError(pollError instanceof Error ? pollError.message : "Search update failed.");
        }
      }
    }

    const firstPoll = window.setTimeout(pollSearch, 700);
    const interval = window.setInterval(pollSearch, 1400);

    return () => {
      isCancelled = true;
      window.clearTimeout(firstPoll);
      window.clearInterval(interval);
    };
  }, [results?.searchId, results?.status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    setFilter("all");
    setSort("match");
    setPage(1);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          browserSessionId,
          businessSpecification
        })
      });

      const payload = (await response.json()) as SearchResponse | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Tender search failed.");
      }

      setResults(payload as SearchResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Tender search failed.");
      setResults(null);
    } finally {
      setIsLoading(false);
    }
  }

  if (!hasCompletedOnboarding) {
    const isWebsiteStep = onboardingStep === 1;

    return (
      <main className="min-h-screen bg-[#eceeed] text-[#13201a]">
        <div className="grid min-h-screen place-items-center px-5 py-24">
          <form
            className="w-full max-w-[680px] text-center"
            onSubmit={isWebsiteStep ? handleWebsiteSubmit : handleLinkedinSubmit}
          >
            <label
              className="block text-3xl font-extrabold leading-tight tracking-normal text-[#13201a] sm:text-[44px]"
              htmlFor={isWebsiteStep ? "company-website" : "linkedin-url"}
            >
              {isWebsiteStep ? "Enter your company website" : "Enter your LinkedIn"}
            </label>
            <input
              autoComplete="url"
              autoFocus
              className="mt-8 h-14 w-full rounded-[12px] border border-[#dfe3e1] bg-white px-5 text-center text-[18px] font-semibold text-[#13201a] outline-none transition placeholder:text-[#a0a8a2] focus:border-[#1f7a4d] focus:ring-4 focus:ring-[#1f7a4d]/12"
              id={isWebsiteStep ? "company-website" : "linkedin-url"}
              inputMode="url"
              onChange={(event) =>
                isWebsiteStep ? setCompanyWebsite(event.target.value) : setLinkedinUrl(event.target.value)
              }
              placeholder={isWebsiteStep ? "https://example.com" : "https://www.linkedin.com/company/example"}
              required
              type="text"
              value={isWebsiteStep ? companyWebsite : linkedinUrl}
            />
            <button className="sr-only" type="submit">
              Continue
            </button>
          </form>
        </div>
        <OnboardingProgress currentStep={onboardingStep} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eceeed] text-[#13201a]">
      <div className="mx-auto max-w-[1320px] px-5 py-10 sm:px-8 xl:px-12 xl:py-11">
        <header className="mb-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-start">
          <div className="max-w-[740px]">
            <p className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.16em] text-[#1f7a4d]">
              Tender Discovery
            </p>
            <h1 className="m-0 max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-normal text-[#13201a] md:text-[52px]">
              Match your business profile to public sector opportunities
            </h1>
          </div>

          <div className="w-full rounded-[14px] border border-[#e4e7e5] bg-white px-5 py-1 shadow-[0_1px_2px_rgba(16,28,22,0.04)] lg:w-[268px]">
            <div className="flex items-center justify-between border-b border-[#eef1ef] py-3.5">
              <span className="text-[13px] text-[#6a746e]">Source</span>
              <span className="text-[13px] font-semibold text-[#13201a]">
                {results?.source === "mock" ? "Mock OCDS" : "Find a Tender OCDS"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-[#eef1ef] py-3.5">
              <span className="text-[13px] text-[#6a746e]">Tenders scored</span>
              <span className="text-[13px] font-semibold text-[#13201a]">
                {results ? `${results.progress.completed}/${results.progress.total}` : "0/0"}
              </span>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <span className="text-[13px] text-[#6a746e]">Visible matches</span>
              <span className="text-[13px] font-bold text-[#1f7a4d]">{filteredAndSortedTenders.length}</span>
            </div>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="flex flex-col gap-[18px]">
              <form
                className="rounded-2xl border border-[#e4e7e5] bg-white p-6 shadow-[0_1px_2px_rgba(16,28,22,0.04)]"
                onSubmit={handleSubmit}
              >
                <label className="mb-3.5 block text-[15px] font-bold text-[#13201a]" htmlFor="business-specification">
                  Business specification
                </label>
                <textarea
                  className="h-[194px] w-full resize-y rounded-[11px] border border-[#dfe3e1] bg-[#fbfcfb] p-3.5 text-[13.5px] leading-relaxed text-[#34403a] outline-none transition placeholder:text-[#9aa1ab] focus:border-[#1f7a4d] focus:ring-4 focus:ring-[#1f7a4d]/10"
                  id="business-specification"
                  onChange={(event) => setBusinessSpecification(event.target.value)}
                  placeholder={exampleSpecification}
                  value={businessSpecification}
                />
                <button
                  className="mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-[#13201a] px-4 py-[13px] text-sm font-semibold tracking-[0.01em] text-white transition hover:bg-[#1f7a4d] disabled:cursor-not-allowed disabled:bg-[#909a93]"
                  disabled={isLoading}
                  type="submit"
                >
                  {isLoading ? <Spinner /> : null}
                  {isLoading ? "Fetching tenders" : "Find matching tenders"}
                </button>
                <div className="mt-3.5 flex items-center gap-2 text-xs text-[#6a746e]">
                  <span
                    className={`h-[7px] w-[7px] flex-none rounded-full ${
                      isEmbedding ? "animate-pulse bg-[#b07315]" : results ? "bg-[#1f7a4d]" : "bg-[#c5ccc7]"
                    }`}
                  />
                  {results
                    ? `${results.progress.isBusinessEmbeddingReady ? "Profile embedded" : "Embedding profile"} · ${strongCount} strong matches found`
                    : "Paste a profile to begin matching"}
                </div>
              </form>

              {results ? (
                <div className="rounded-2xl border border-[#e4e7e5] bg-white p-6 shadow-[0_1px_2px_rgba(16,28,22,0.04)]">
                  <h2 className="mb-3.5 text-[13px] font-bold text-[#13201a]">Extracted terms</h2>
                  <div className="flex flex-wrap gap-2">
                    {results.queryTerms.map((term) => (
                      <span
                        className="rounded-md bg-[#eef4f0] px-2.5 py-1.5 text-[12.5px] font-medium text-[#1f6a45]"
                        key={term}
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-[#eef1ef] pt-3.5 font-mono text-[11.5px] text-[#9aa1ab]">
                    profile vector · {results.businessProfileHash.slice(0, 16)}
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#6a746e]">
                      <span>{isEmbedding ? "Embedding tenders" : "Embedding complete"}</span>
                      <span>
                        {results.progress.completed}/{results.progress.total}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#eef1ef]">
                      <div
                        className="h-full rounded-full bg-[#1f7a4d] transition-all"
                        style={{
                          width:
                            results.progress.total > 0
                              ? `${Math.round((results.progress.completed / results.progress.total) * 100)}%`
                              : "0%"
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0">
            <div ref={resultsTopRef} className="scroll-mt-24" />
            <div className="mb-[18px] flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-sm font-bold text-[#13201a]">
                  {filteredAndSortedTenders.length} opportunities
                </span>
                <span className="hidden h-1 w-1 rounded-full bg-[#c5ccc7] sm:inline" />
                <div className="flex flex-wrap gap-1.5">
                  <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
                    All · {counts.all}
                  </FilterButton>
                  <FilterButton active={filter === "high"} onClick={() => setFilter("high")}>
                    Strong · {counts.high}
                  </FilterButton>
                  <FilterButton active={filter === "medium"} onClick={() => setFilter("medium")}>
                    Possible · {counts.medium}
                  </FilterButton>
                  <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>
                    Open now · {counts.active}
                  </FilterButton>
                </div>
                <label className="ml-1 inline-flex items-center gap-2 rounded-lg border border-[#e1e5e2] bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-[#525a60]">
                  <input
                    checked={hideExpired}
                    className="h-4 w-4 accent-[#1f7a4d]"
                    onChange={(event) => setHideExpired(event.target.checked)}
                    type="checkbox"
                  />
                  No expired tenders
                </label>
              </div>

              <label className="flex items-center gap-2 text-[12.5px] text-[#6a746e]">
                Sort
                <select
                  className="rounded-[9px] border border-[#dfe3e1] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#13201a] outline-none"
                  onChange={(event) => setSort(event.target.value as SortMode)}
                  value={sort}
                >
                  <option value="match">Best match</option>
                  <option value="value">Highest value</option>
                  <option value="deadline">Closing soonest</option>
                </select>
              </label>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-[#f4cbc6] bg-[#fdeceb] p-4 text-sm font-semibold text-[#b42318]">
                {error}
              </div>
            ) : null}

            {results?.warnings.map((warning) => (
              <div
                className="mb-4 rounded-2xl border border-[#eedcb2] bg-[#fbf1de] p-4 text-sm font-semibold text-[#8a560f]"
                key={warning}
              >
                {warning}
              </div>
            ))}

            {isLoading ? (
              <div className="grid min-h-72 place-items-center rounded-2xl border border-[#e4e7e5] bg-white">
                <div className="flex items-center gap-3 text-sm font-semibold text-[#6a746e]">
                  <Spinner dark />
                  Fetching procurement notices
                </div>
              </div>
            ) : rankedTenders.length > 0 ? (
              <div className="flex flex-col gap-3.5">
                {isEmbedding ? (
                  <div className="rounded-2xl border border-[#e4e7e5] bg-white p-4 text-sm font-semibold text-[#6a746e]">
                    <div className="flex items-center gap-3">
                      <Spinner dark />
                      Ranking is updating as embeddings are generated in batches.
                    </div>
                  </div>
                ) : null}
                {rankedTenders.map((tender, index) => (
                  <TenderCard
                    isEmbedding={Boolean(isEmbedding)}
                    key={`${tender.id}-${tender.title}-${tender.deadlineDate}-${index}-${tender.embeddingStatus}`}
                    tender={tender}
                  />
                ))}
                <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-[#e4e7e5] bg-white px-4 py-3 text-sm text-[#6a746e] sm:flex-row">
                  <span>
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}-
                    {Math.min(currentPage * PAGE_SIZE, filteredAndSortedTenders.length)} of{" "}
                    {filteredAndSortedTenders.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-[#e1e5e2] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#525a60] transition hover:border-[#c8e3d4] hover:text-[#13201a] disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={currentPage <= 1}
                      onClick={() => changePage(currentPage - 1)}
                      type="button"
                    >
                      Previous
                    </button>
                    <form className="flex items-center gap-2" onSubmit={handlePageInputSubmit}>
                      <input
                        aria-label="Page number"
                        className="h-9 w-16 rounded-lg border border-[#dfe3e1] bg-white px-2 text-center text-[12.5px] font-semibold text-[#13201a] outline-none focus:border-[#1f7a4d] focus:ring-2 focus:ring-[#1f7a4d]/10"
                        inputMode="numeric"
                        min={1}
                        max={totalPages}
                        onChange={(event) => setPageInput(event.target.value)}
                        type="number"
                        value={pageInput}
                      />
                      <span className="text-[12.5px] font-semibold text-[#13201a]">/ {totalPages}</span>
                    </form>
                    <button
                      className="rounded-lg border border-[#1f7a4d] bg-[#1f7a4d] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#15643f] disabled:cursor-not-allowed disabled:border-[#c5ccc7] disabled:bg-[#c5ccc7]"
                      disabled={currentPage >= totalPages}
                      onClick={() => changePage(currentPage + 1)}
                      type="button"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-[#dfe3e1] bg-white p-8 text-center">
                <div>
                  <h2 className="text-lg font-bold text-[#13201a]">No tender matches loaded</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-[#5c655f]">
                    Add a business profile with sector, services, delivery model, and technology terms.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
