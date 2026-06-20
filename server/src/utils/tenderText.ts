import type { Tender } from "../../../shared/tender.js";

export function tenderToSearchText(tender: Tender): string {
  return [
    tender.title,
    tender.buyerName,
    tender.description,
    tender.value > 0 ? `${tender.value} ${tender.currency}` : "",
    tender.documentationUrls.join(" ")
  ]
    .filter(Boolean)
    .join("\n");
}
