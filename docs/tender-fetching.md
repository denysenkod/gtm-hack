# Tender Fetching and Normalization

## Source Used

The live source is the UK Find a Tender Service OCDS release package API:

```text
https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
```

This source was chosen because it is open, public, and returns procurement notices in Open Contracting Data Standard (OCDS) format. The prototype does not require an API key for this source.

The implementation lives in:

- `server/src/clients/findTenderClient.ts`
- `server/src/types/ocds.ts`
- `server/src/normalizers/ocds.ts`

## Request Shape

The backend fetches candidate tender releases using these query parameters:

```text
updatedFrom=<UTC timestamp>
updatedTo=<UTC timestamp>
stages=tender
limit=<page size>
```

Defaults:

- `updatedFrom`: current UTC time minus `FIND_TENDER_LOOKBACK_DAYS`, default `120`
- `updatedTo`: current UTC time
- `stages`: `tender`
- `limit`: `FIND_TENDER_PAGE_LIMIT`, default `100`
- pages inspected: `FIND_TENDER_MAX_PAGES`, default `2`
- timeout: `PROCUREMENT_API_TIMEOUT_MS`, default `8000`

The timestamp format is `YYYY-MM-DDTHH:mm:ss`, matching the Find a Tender API expectation.

## Pagination

The API returns an OCDS release package with optional pagination links. The client starts with the configured date window and follows `links.next` until either:

- no `next` link is present, or
- `FIND_TENDER_MAX_PAGES` is reached.

This keeps the prototype bounded and avoids pulling an unbounded number of notices into the vector index.

## Data Fetched

The source returns OCDS release packages. The fields this prototype cares about are:

- `release.ocid`
- `release.id`
- `release.date`
- `release.buyer.name`
- `release.parties`
- `release.tender.title`
- `release.tender.description`
- `release.tender.status`
- `release.tender.value.amount`
- `release.tender.value.currency`
- `release.tender.minValue`
- `release.tender.tenderPeriod.startDate`
- `release.tender.tenderPeriod.endDate`
- `release.tender.enquiryPeriod.endDate`
- `release.tender.documents`
- `release.tender.items`
- `release.tender.communication.atypicalToolUrl`
- `release.planning.documents`
- `release.awards[].documents`
- `release.contracts[].documents`

## Normalized Tender Shape

OCDS releases are mapped into the shared local `Tender` interface:

```ts
interface Tender {
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
```

Mapping decisions:

- `id`: `release.ocid`, falling back to `tender.id`, `release.id`, or a generated UUID.
- `title`: `tender.title`.
- `buyerName`: `release.buyer.name`, falling back to the first party with `buyer` role.
- `description`: combines `tender.description`, `procurementMethodDetails`, item descriptions, and CPV classification descriptions.
- `value`: `tender.value.amount`, falling back to `tender.minValue.amount`, then `0`.
- `currency`: `tender.value.currency`, falling back to `tender.minValue.currency`, then `GBP`.
- `publicationDate`: `release.date`, falling back to `tender.tenderPeriod.startDate`.
- `deadlineDate`: `tender.tenderPeriod.endDate`, falling back to `tender.enquiryPeriod.endDate`.
- `documentationUrls`: unique URLs from planning, tender, award, contract documents, plus the tender communication URL.
- `status`: active if OCDS tender status is `active` or if the deadline is in the future.

Releases without a tender object, title, or description are discarded because they cannot be usefully ranked or displayed.

## Mock Fallback

If the live API times out, rate-limits, or returns an error, the server falls back to a typed mock OCDS release package in:

```text
server/src/data/mockFindTenderResponse.ts
```

The mock data uses the same OCDS-like structure as the live client path so the normalizer, vector search, and UI are exercised the same way.

You can force mock mode with:

```bash
USE_MOCK_PROCUREMENT_API=true
```

## Error Handling

The client explicitly handles:

- `429`: treated as a retryable procurement API rate-limit error.
- non-2xx responses: converted to `ProcurementApiError`.
- request timeout: uses `AbortController`.
- network or parse failures: fall back to mock data with a response warning.

The response warning is returned to the frontend so the user can see whether results came from live data or fallback data.
