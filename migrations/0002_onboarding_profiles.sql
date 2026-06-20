CREATE INDEX IF NOT EXISTS search_jobs_browser_session_idx
  ON search_jobs (browser_session_id);

CREATE TABLE IF NOT EXISTS browser_sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS onboarding_profiles (
  session_id TEXT PRIMARY KEY,
  company_website TEXT NOT NULL,
  linkedin_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES browser_sessions (session_id)
);
