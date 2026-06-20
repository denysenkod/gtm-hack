import type { Tender } from "../../../shared/tender.js";
import type { OcdsDocument, OcdsRelease, OcdsTender } from "../types/ocds.js";
import { isFutureDate } from "../utils/dates.js";

function collectDocumentUrls(release: OcdsRelease): string[] {
  const documents: OcdsDocument[] = [
    ...(release.planning?.documents ?? []),
    ...(release.tender?.documents ?? []),
    ...(release.awards ?? []).flatMap((award) => award.documents ?? []),
    ...(release.contracts ?? []).flatMap((contract) => contract.documents ?? [])
  ];

  const rawUrls = documents
    .flatMap((document) => [document.url, document.uri])
    .concat(release.tender?.communication?.atypicalToolUrl)
    .filter((value): value is string => Boolean(value));

  return [...new Set(rawUrls)];
}

function buildDescription(tender: OcdsTender | undefined): string {
  const itemDescriptions =
    tender?.items
      ?.flatMap((item) => [
        item.description,
        item.classification?.description,
        ...(item.additionalClassifications ?? []).map((classification) => classification.description)
      ])
      .filter((value): value is string => Boolean(value)) ?? [];

  return [tender?.description, tender?.procurementMethodDetails, ...itemDescriptions]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

function resolveBuyerName(release: OcdsRelease): string {
  const buyerParty = release.parties?.find((party) => party.roles?.includes("buyer"));

  return release.buyer?.name ?? buyerParty?.name ?? "Unknown buyer";
}

function resolveValue(tender: OcdsTender | undefined): { value: number; currency: string } {
  return {
    value: tender?.value?.amount ?? tender?.minValue?.amount ?? 0,
    currency: tender?.value?.currency ?? tender?.minValue?.currency ?? "GBP"
  };
}

export function normalizeOcdsRelease(release: OcdsRelease): Tender | null {
  if (!release.tender) {
    return null;
  }

  const { tender } = release;
  const title = tender.title?.trim();
  const description = buildDescription(tender).trim();
  const deadlineDate = tender.tenderPeriod?.endDate ?? tender.enquiryPeriod?.endDate ?? "";
  const status = tender.status === "active" || isFutureDate(deadlineDate) ? "active" : "closed";
  const { value, currency } = resolveValue(tender);

  if (!title || !description) {
    return null;
  }

  return {
    id: release.ocid ?? tender.id ?? release.id ?? crypto.randomUUID(),
    title,
    buyerName: resolveBuyerName(release),
    description,
    value,
    currency,
    publicationDate: release.date ?? tender.tenderPeriod?.startDate ?? "",
    deadlineDate,
    documentationUrls: collectDocumentUrls(release),
    status
  };
}

export function normalizeOcdsReleases(releases: OcdsRelease[]): Tender[] {
  return releases
    .map(normalizeOcdsRelease)
    .filter((tender): tender is Tender => tender !== null);
}
