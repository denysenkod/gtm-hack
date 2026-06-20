const STOP_WORDS = new Set([
  "about",
  "above",
  "across",
  "after",
  "again",
  "against",
  "also",
  "among",
  "and",
  "are",
  "around",
  "because",
  "been",
  "being",
  "between",
  "both",
  "business",
  "can",
  "company",
  "could",
  "delivery",
  "deliver",
  "delivered",
  "delivering",
  "does",
  "each",
  "for",
  "from",
  "have",
  "having",
  "into",
  "our",
  "over",
  "provide",
  "provides",
  "services",
  "shall",
  "should",
  "such",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "through",
  "under",
  "using",
  "were",
  "with",
  "within",
  "would",
  "your"
]);

export function extractKeyTerms(input: string, maxTerms = 8): string[] {
  const counts = new Map<string, number>();

  for (const rawToken of input.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []) {
    const token = rawToken.replace(/^-+|-+$/g, "");

    if (token.length < 3 || STOP_WORDS.has(token) || /^\d+$/.test(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([leftTerm, leftCount], [rightTerm, rightCount]) => {
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      return leftTerm.localeCompare(rightTerm);
    })
    .slice(0, maxTerms)
    .map(([term]) => term);
}

export function scoreTextAgainstTerms(text: string, terms: string[]): number {
  const normalizedText = text.toLowerCase();

  return terms.reduce((score, term) => {
    if (!normalizedText.includes(term.toLowerCase())) {
      return score;
    }

    return score + (term.length > 5 ? 2 : 1);
  }, 0);
}
