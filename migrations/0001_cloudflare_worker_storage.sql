CREATE TABLE IF NOT EXISTS vector_records (
  key TEXT PRIMARY KEY,
  record_type TEXT NOT NULL CHECK (record_type IN ('business-profile', 'tender')),
  external_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  model_name TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding_json TEXT NOT NULL,
  tender_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS vector_records_lookup_idx
  ON vector_records (record_type, model_name, external_id, text_hash);

CREATE TABLE IF NOT EXISTS search_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing', 'complete', 'failed')),
  business_specification TEXT NOT NULL,
  business_profile_hash TEXT NOT NULL,
  query_terms_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('find-a-tender', 'mock')),
  source_warnings_json TEXT NOT NULL,
  tenders_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS search_jobs_updated_at_idx
  ON search_jobs (updated_at);
