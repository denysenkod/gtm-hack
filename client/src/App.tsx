import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SearchResponse, TenderMatch } from "../../shared/tender";

const exampleSpecification =
  "We deliver secure cloud software, workflow automation, CRM integration, data migration, analytics dashboards, and support for public sector health and local government teams.";

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

function deadlineTone(days: number | null): string {
  if (days === null) {
    return "border-slate-300 bg-slate-50 text-slate-700";
  }

  if (days <= 7) {
    return "border-signal bg-orange-50 text-signal";
  }

  if (days <= 21) {
    return "border-amber-400 bg-amber-50 text-amber-800";
  }

  return "border-moss bg-mist text-moss";
}

function deadlineLabel(days: number | null): string {
  if (days === null) {
    return "Deadline not specified";
  }

  if (days < 0) {
    return "Deadline passed";
  }

  if (days === 0) {
    return "Due today";
  }

  if (days === 1) {
    return "Due tomorrow";
  }

  return `${days} days left`;
}

function matchTone(tender: TenderMatch): string {
  if (tender.embeddingStatus === "pending") {
    return "border-slate-300 bg-slate-50 text-slate-600";
  }

  if (tender.embeddingStatus === "failed") {
    return "border-signal bg-orange-50 text-signal";
  }

  const { matchQuality: quality } = tender;

  if (quality === "high") {
    return "border-moss bg-mist text-moss";
  }

  if (quality === "medium") {
    return "border-amber-400 bg-amber-50 text-amber-800";
  }

  return "border-slate-300 bg-slate-50 text-slate-700";
}

function formatMatchScore(tender: TenderMatch): string {
  if (tender.embeddingStatus === "pending") {
    return "- (0%)";
  }

  if (tender.embeddingStatus === "failed") {
    return "Failed";
  }

  const { matchScore: score } = tender;
  return `${Math.round(score * 100)}%`;
}

function matchLabel(tender: TenderMatch): string {
  if (tender.embeddingStatus === "pending") {
    return "Embedding";
  }

  if (tender.embeddingStatus === "failed") {
    return "Embedding failed";
  }

  return `${tender.matchQuality} match`;
}

function TenderCard({ tender }: { tender: TenderMatch }) {
  const days = daysUntil(tender.deadlineDate);
  const strictWarning = days !== null && days <= 7 && days >= 0;

  return (
    <details className="group overflow-hidden rounded-lg border border-line bg-white shadow-lift">
      <summary className="grid cursor-pointer gap-4 p-5 md:grid-cols-[1fr_auto] md:items-start">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded border border-line px-2 py-1 text-xs font-semibold uppercase tracking-normal text-slate-600">
              {tender.status}
            </span>
            <span className={`rounded border px-2 py-1 text-xs font-semibold ${deadlineTone(days)}`}>
              {deadlineLabel(days)}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold ${matchTone(tender)}`}
            >
              {tender.embeddingStatus === "pending" ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : null}
              {matchLabel(tender)}
            </span>
          </div>
          <h2 className="text-lg font-semibold leading-snug text-ink">{tender.title}</h2>
          <p className="mt-2 text-sm font-medium text-slate-700">{tender.buyerName}</p>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{tender.description}</p>
        </div>
        <div className="grid gap-2 text-left md:min-w-48 md:text-right">
          <span className="text-sm text-slate-500">Estimated value</span>
          <span className="text-lg font-semibold text-ink">
            {formatCurrency(tender.value, tender.currency)}
          </span>
          <span className="text-sm font-semibold text-moss">
            {formatMatchScore(tender)} match quality
          </span>
          <span className="text-sm text-slate-500">{formatDate(tender.deadlineDate)}</span>
        </div>
      </summary>

      <div className="border-t border-line px-5 py-5">
        {strictWarning ? (
          <div className="mb-5 rounded-md border border-signal bg-orange-50 px-4 py-3 text-sm font-semibold text-signal">
            Strict deadline warning: this tender closes within 7 days.
          </div>
        ) : null}

        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-500">Publication date</dt>
            <dd className="mt-1 text-ink">{formatDate(tender.publicationDate)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Deadline date</dt>
            <dd className="mt-1 text-ink">{formatDate(tender.deadlineDate)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Cosine match score</dt>
            <dd className="mt-1 text-ink">{formatMatchScore(tender)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Embedding status</dt>
            <dd className="mt-1 capitalize text-ink">{tender.embeddingStatus}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Buyer</dt>
            <dd className="mt-1 text-ink">{tender.buyerName}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Tender ID</dt>
            <dd className="mt-1 break-all text-ink">{tender.id}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-500">Documentation</h3>
          {tender.documentationUrls.length > 0 ? (
            <ul className="mt-2 grid gap-2">
              {tender.documentationUrls.map((url) => (
                <li key={url}>
                  <a
                    className="inline-flex max-w-full items-center rounded-md border border-line px-3 py-2 text-sm font-semibold text-moss transition hover:border-moss hover:bg-mist"
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
            <p className="mt-2 text-sm text-slate-600">No direct documentation links were published.</p>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-500">Complete scope text</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{tender.description}</p>
        </div>
      </div>
    </details>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
    />
  );
}

export default function App() {
  const [businessSpecification, setBusinessSpecification] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const rankedTenders = useMemo(() => results?.tenders ?? [], [results]);
  const isEmbedding = results?.status === "processing";

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

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ businessSpecification })
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

  return (
    <main className="min-h-screen bg-[#F8FAF8]">
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-normal text-moss">Tender discovery</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-ink md:text-5xl">
              Match your business profile to public sector opportunities
            </h1>
          </div>
          <div className="grid gap-3 self-end rounded-lg border border-line bg-mist p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-600">Source</span>
              <span className="text-sm font-semibold text-ink">
                {results?.source === "mock" ? "Mock OCDS fallback" : "Find a Tender OCDS"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-600">Matches</span>
              <span className="text-sm font-semibold text-ink">{rankedTenders.length}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-600">Embedded</span>
              <span className="text-sm font-semibold text-ink">
                {results ? `${results.progress.completed}/${results.progress.total}` : "0/0"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[24rem_minmax(0,1fr)] lg:px-8">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <form className="rounded-lg border border-line bg-white p-5 shadow-lift" onSubmit={handleSubmit}>
            <label className="text-sm font-semibold text-ink" htmlFor="business-specification">
              Business Specification / Profile
            </label>
            <textarea
              className="mt-3 min-h-72 w-full resize-y rounded-md border border-line bg-white p-3 text-sm leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-moss focus:ring-4 focus:ring-moss/10"
              id="business-specification"
              onChange={(event) => setBusinessSpecification(event.target.value)}
              placeholder={exampleSpecification}
              value={businessSpecification}
            />
            <button
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={isLoading}
              type="submit"
            >
              {isLoading ? <Spinner /> : null}
              {isLoading ? "Searching tenders" : "Find Matching Tenders"}
            </button>
          </form>

          {results ? (
            <div className="mt-4 rounded-lg border border-line bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-500">Extracted terms</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {results.queryTerms.map((term) => (
                  <span
                    className="rounded border border-line bg-mist px-2 py-1 text-xs font-semibold text-moss"
                    key={term}
                  >
                    {term}
                  </span>
                ))}
              </div>
              <p className="mt-4 break-all text-xs leading-5 text-slate-500">
                Profile vector: {results.businessProfileHash.slice(0, 16)}
              </p>
              {isEmbedding ? (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>Embedding tenders</span>
                    <span>
                      {results.progress.completed}/{results.progress.total}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-moss transition-all"
                      style={{
                        width:
                          results.progress.total > 0
                            ? `${Math.round((results.progress.completed / results.progress.total) * 100)}%`
                            : "0%"
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="min-w-0">
          {error ? (
            <div className="rounded-lg border border-signal bg-orange-50 p-4 text-sm font-semibold text-signal">
              {error}
            </div>
          ) : null}

          {results?.warnings.map((warning) => (
            <div
              className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900"
              key={warning}
            >
              {warning}
            </div>
          ))}

          {isLoading ? (
            <div className="grid min-h-72 place-items-center rounded-lg border border-line bg-white">
              <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-moss border-t-transparent" />
                Searching procurement notices
              </div>
            </div>
          ) : rankedTenders.length > 0 ? (
            <div className="grid gap-4">
              {isEmbedding ? (
                <div className="rounded-lg border border-line bg-white p-4 text-sm font-semibold text-slate-600">
                  <div className="flex items-center gap-3">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-moss border-t-transparent" />
                    Ranking is updating as embeddings are generated in batches.
                  </div>
                </div>
              ) : null}
              {rankedTenders.map((tender) => (
                <TenderCard key={tender.id} tender={tender} />
              ))}
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-line bg-white p-8 text-center">
              <div>
                <h2 className="text-lg font-semibold text-ink">No tender matches loaded</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                  Add a business profile with sector, services, delivery model, and technology terms.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
