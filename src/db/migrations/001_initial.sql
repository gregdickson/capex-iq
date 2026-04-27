-- CapexIQ initial schema

CREATE TABLE IF NOT EXISTS pipeline_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO pipeline_settings (key, value, description) VALUES
  ('daily_send_limit', '150', 'Max contacts pushed to GHL per day'),
  ('ai_validation_threshold', '55', 'CapexIQ score above which AI validation runs'),
  ('reprocess_window_days', '90', 'Days before a domain can be reprocessed'),
  ('matching_rate_limit_ms', '3000', 'Milliseconds between matching jobs'),
  ('qualification_rate_limit_ms', '2500', 'Milliseconds between qualification jobs'),
  ('email_generation_rate_limit_ms', '10000', 'Milliseconds between email generation jobs'),
  ('model_entity_extraction', 'openai/gpt-4o-mini', 'OpenRouter model for company name extraction'),
  ('model_ca_analysis', 'moonshotai/kimi-k2.5', 'OpenRouter model for CA validation'),
  ('model_email_generation', 'anthropic/claude-sonnet-4-20250514', 'OpenRouter model for email sequences'),
  ('webhook_url', '', 'URL for daily summary and failure alert notifications'),
  ('webhook_enabled', 'false', 'Enable/disable webhook notifications')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS pipeline_prompts (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_prompt
  ON pipeline_prompts(key) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id SERIAL PRIMARY KEY,
  csv_filename TEXT,
  total_records INTEGER DEFAULT 0,
  after_filter INTEGER DEFAULT 0,
  matched INTEGER DEFAULT 0,
  no_match INTEGER DEFAULT 0,
  qualified INTEGER DEFAULT 0,
  ai_validated INTEGER DEFAULT 0,
  emails_generated INTEGER DEFAULT 0,
  ready_to_send INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed_companies (
  id SERIAL PRIMARY KEY,
  pipeline_run_id INTEGER REFERENCES pipeline_runs(id),
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Contact
  contact_email TEXT,
  contact_first_name TEXT,
  contact_last_name TEXT,
  contact_full_name TEXT,
  contact_position TEXT,
  contact_seniority TEXT,
  contact_linkedin TEXT,
  org_name TEXT,
  org_size TEXT,
  org_city TEXT,
  org_country TEXT,
  org_industry TEXT,
  -- Company (from matching)
  company_number TEXT,
  company_name TEXT,
  match_source TEXT,
  -- Scoring
  capexiq_score INTEGER,
  ppe_score NUMERIC,
  sic_score NUMERIC,
  investment_activity_score NUMERIC,
  asset_intensity_score NUMERIC,
  ppe_category TEXT,
  opportunity_value TEXT,
  ca_indicators TEXT[],
  -- Financials (full DataLedger response)
  financials JSONB,
  -- AI analysis (for score > threshold)
  ca_analysis JSONB,
  -- Email generation
  email_sequence JSONB,
  prompt_version_id INTEGER REFERENCES pipeline_prompts(id),
  -- GHL
  ghl_contact_id TEXT,
  -- Tracking
  error_log JSONB,
  retry_count INTEGER DEFAULT 0,
  matched_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  emails_generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(domain, pipeline_run_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_domain ON processed_companies(domain);
CREATE INDEX IF NOT EXISTS idx_pc_status ON processed_companies(status);
CREATE INDEX IF NOT EXISTS idx_pc_ready_to_send ON processed_companies(status) WHERE status = 'ready_to_send';
CREATE INDEX IF NOT EXISTS idx_pc_pipeline_run ON processed_companies(pipeline_run_id);
