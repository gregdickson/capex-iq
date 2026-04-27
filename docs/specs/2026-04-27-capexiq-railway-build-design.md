# CapexIQ Railway Build — Design Spec

**Date:** 2026-04-27
**Status:** Approved — proceeding to implementation planning

---

## 1. Goal

Port the CapexIQ lead qualification and outreach pipeline from n8n (Nano plan) to a standalone TypeScript web application running on Railway. The system processes CSV lead lists through qualification, scoring, AI validation, and personalised email generation, then drip-feeds qualified contacts into GoHighLevel at a configurable daily rate.

**Single user.** No multi-tenant, no auth beyond Railway's private networking.

**Success criteria:**
- Upload a CSV via browser, pipeline runs unattended
- Every record has a visible status — nothing silently disappears
- GHL sends are rate-limited to a configurable daily cap (default 150)
- Scoring threshold, LLM models, prompts, and daily send limit adjustable from the dashboard without redeploying
- Daily summary webhook notification

---

## 2. Current State Audit

### 2a. Existing Codebase

**The repo is empty.** One commit, README only. This is a greenfield build.

**File: README.md (line 1-2)**
- Contains only project description. No code, no config, no dependencies.

### 2b. Existing n8n Workflows (source of truth for business logic)

| Workflow | File | Purpose |
|----------|------|---------|
| WF 1.5 — CSV Intake | `01.5 - CSV Intake.json` | Upload, filter, dedup, drip-feed to matching |
| WF 2a — Company Matching | `02a — Company Matching.json` | Domain → Companies House number via SerpAPI chain |
| WF 02 — Qualification | `02 — CapexIQ Qualification.json` | DataLedger financials → scoring → AI validation |
| WF 3b — Email Generation | `03b — Email Content Generation.json` | RAG + LLM → 5-email drip → GHL push |

### 2c. Known Bugs to Fix During Port

| Bug | Source | Resolution |
|-----|--------|------------|
| Score field mismatch: scoring outputs `enhanced_ca_score`, threshold checks `capexiq_score` | WF 02 JSON: "Score > 55" node checks `capexiq_score` (line 132-140) but scoring engine outputs `enhanced_ca_score` | Unify to `capexiqScore` throughout |
| "Assets >= 100K" gate checks £10K, both paths go to scoring anyway | WF 02 JSON: "Assets >= 100K" node (line 86-107) checks `>= 10000`, no filtering effect | Remove gate entirely |
| "Log No Match" disconnected in WF 2a | WF 2a JSON: Google Sheets "Log No Match" node has no incoming connections | Implement proper no-match logging to DB |
| 90-day reprocess window doesn't exist | WF 1.5: dedup is binary exists/doesn't, no date comparison | Implement with configurable `reprocess_window_days` setting |
| Email 5 subject missing from GHL push | WF 3b JSON: GHL node maps subjects for emails 1-4 only, 5 bodies | Map all 5 subjects, bodies, and preheaders |
| No error handling in WF 3b | WF 3b JSON: no error outputs on AI Agent or GHL nodes | BullMQ retry + error logging handles this |
| DataLedger API key hardcoded | WF 02 JSON: literal string in header params | Environment variable |
| n8n splits `fullName` to get first/last name | WF 2a: `fullName.split(' ')[0]` | Use `firstName` and `lastName` columns directly — they exist in the CSV |
| UK filter uses `orgCountry` | WF 1.5: checks `orgCountry` | Use `country` (contact location) with fallback to `orgCountry` — catches UK contacts at US-HQ companies |

### 2d. CSV Source Format (Apify Apollo/ZoomInfo/Lusha Scraper)

**Single source.** All CSVs come from the same Apify actor: `lead-scraper-apollo-zoominfo-lusha`.

**Columns (24 total):**

| Column | Type | Used In | Notes |
|--------|------|---------|-------|
| `firstName` | string | Contact | Use directly (don't split fullName) |
| `lastName` | string | Contact | Use directly |
| `fullName` | string | Contact | Backup if firstName/lastName missing |
| `email` | string | Contact, Filter | Required — no email = filtered out |
| `position` | string | Contact, Seniority | Job title text |
| `seniority` | string | Contact, Dedup | Values: `founder`, `c_suite`, `director`, `manager`, `entry` |
| `city` | string | Contact | Contact's city |
| `country` | string | Filter | **Contact's country** — primary UK filter field |
| `state` | string | — | UK region (e.g., "England", "Northern Ireland") |
| `phone` | string | Contact | Often empty |
| `linkedinUrl` | string | Contact | Full LinkedIn URL |
| `functional` | string | — | Role categories as JSON array string, e.g., `"['finance']"` |
| `orgName` | string | Company | Company display name |
| `orgWebsite` | string | Company, Matching | Used for domain normalisation |
| `orgSize` | string/number | Filter | Plain number ("4", "520") — NOT range strings |
| `orgCountry` | string | — | Company HQ country (fallback for UK filter) |
| `orgCity` | string | Company | Company HQ city |
| `orgState` | string | — | Company HQ state |
| `orgIndustry` | string | Context | JSON array string, e.g., `"['hospitality']"` |
| `orgDescription` | string | Email Gen | Long text — pass to LLM context, don't store in DB |
| `orgFoundedYear` | string | — | Not used |
| `orgLinkedinUrl` | string | — | Not used |
| `ppeBatchIndex` | number | — | Apify pagination — ignore |
| `ppeIndex` | number | — | Apify pagination — ignore |

**Key design decisions from CSV analysis:**
1. `country` (contact location) is the UK filter field, not `orgCountry` — catches UK contacts at US/EU-HQ companies
2. `orgSize` is always a plain number from this source — but we still handle range strings for robustness
3. `orgDescription` is valuable LLM context for email personalisation but too large to persist in DB
4. `firstName`/`lastName` are first-class columns — no need to split `fullName`
5. `orgIndustry` stored as supplementary industry signal alongside SIC codes from Companies House

---

## 3. Architecture

### 3a. Railway Services

```
┌─────────────────────────────────────────────────────┐
│  Railway Project: capexiq                           │
│                                                     │
│  ┌─────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  API Service │  │  Worker  │  │  Cron Service  │  │
│  │  (Express)   │  │ (BullMQ) │  │  (daily send,  │  │
│  │  Port 3000   │  │  always- │  │   retry,       │  │
│  │  + Dashboard │  │  on      │  │   summary)     │  │
│  └──────┬───────┘  └────┬─────┘  └───────┬────────┘  │
│         │               │                │           │
│  ┌──────┴───────────────┴────────────────┴────────┐  │
│  │              Redis (BullMQ queues)              │  │
│  └─────────────────────┬──────────────────────────┘  │
│  ┌─────────────────────┴──────────────────────────┐  │
│  │              PostgreSQL                         │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         │
         │ (external)
         ▼
┌──────────────────┐
│  Supabase        │
│  (vector store)  │
└──────────────────┘
```

- **API Service** — Express: CSV upload, dashboard (server-rendered HTML), settings/prompt management, health check. Public domain.
- **Worker Service** — BullMQ consumer processing all pipeline queues. Private networking only.
- **Cron Service** — Daily GHL send drip, retry failed jobs, daily summary webhook. Railway cron scheduler.
- **Redis** — Railway one-click provision. Powers BullMQ.
- **PostgreSQL** — Railway one-click provision. All pipeline data.
- **Supabase** — Existing vector store for capital allowances knowledge base. Accessed via Supabase client + OpenAI embeddings. No migration needed.

### 3b. Pipeline Flow — Decoupled Processing and Sending

```
CSV Upload
    │
    ▼
┌──────────────────┐
│  Intake           │  Parse CSV, apply filters (UK, SME, chain blocklist,
│  (synchronous)    │  email required), dedup by domain (keep best seniority),
│                   │  check reprocess window, enqueue survivors
└────────┬──────────┘
         │ (1 job per record)
         ▼
┌──────────────────┐
│  Matching Queue   │  SerpAPI domain search → AI mode → LLM extraction →
│  1 job / 3s       │  SerpAPI CH search → regex extract company number
│                   │  Fallback: Companies House API direct search
└────────┬──────────┘
         │
         ▼
┌──────────────────┐
│  Qualification    │  DataLedger API → extract financials → scoring engine
│  Queue            │  → if score > threshold: AI validation (configurable model)
│  2 jobs / 5s      │  → store all results in DB
└────────┬──────────┘
         │
         ▼
┌──────────────────┐
│  Email Generation │  Build LLM context → query Supabase vector store (RAG)
│  Queue            │  → generate 5-email sequence (configurable model + prompt)
│  1 job / 10s      │  → store emails in DB → status: "ready_to_send"
└────────┬──────────┘
         │
         │  *** Records wait here until Cron picks them up ***
         │
         ▼
┌──────────────────┐
│  GHL Send         │  Cron job runs daily, picks up to daily_send_limit
│  (Cron-driven)    │  records, pushes to GoHighLevel, marks "sent"
└──────────────────┘
```

### 3c. Record Status Lifecycle

Every record in `processed_companies` tracks its position:

```
pending → matching → matched → qualifying → scored →
  generating_emails → ready_to_send → sent
                    ↘ failed_matching (error_log has detail)
                    ↘ failed_qualification
                    ↘ failed_email_generation
                    ↘ failed_ghl_push
                    ↘ no_match (company not found)
                    ↘ filtered (didn't pass intake filters)
                    ↘ duplicate (already processed within reprocess window)
```

---

## 4. Database Schema

### 4a. Pipeline Settings

```sql
CREATE TABLE pipeline_settings (
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
  ('webhook_enabled', 'false', 'Enable/disable webhook notifications');
```

### 4b. Pipeline Prompts

```sql
CREATE TABLE pipeline_prompts (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE UNIQUE INDEX idx_active_prompt ON pipeline_prompts(key) WHERE is_active = true;
```

Keys: `email_generation_system`, `email_generation_user`, `ca_analysis_system`, `ca_analysis_user`

Editing a prompt: sets current active to `is_active = false`, inserts new row with `version + 1` and `is_active = true`. Full version history preserved for rollback.

### 4c. Pipeline Runs

```sql
CREATE TABLE pipeline_runs (
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
```

### 4d. Processed Companies

```sql
CREATE TABLE processed_companies (
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
  org_industry TEXT,           -- from Apify CSV, e.g. "hospitality"
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

CREATE INDEX idx_pc_domain ON processed_companies(domain);
CREATE INDEX idx_pc_status ON processed_companies(status);
CREATE INDEX idx_pc_ready_to_send ON processed_companies(status) WHERE status = 'ready_to_send';
CREATE INDEX idx_pc_pipeline_run ON processed_companies(pipeline_run_id);
```

Note: `prompt_version_id` tracks which prompt version generated each email, enabling you to see which prompt produced which results when A/B testing.

---

## 5. External API Map

| API | Used In | Auth | Rate Limit | npm Package |
|-----|---------|------|------------|-------------|
| SerpAPI | Matching (3 calls/record) | API key | Plan-dependent | `serpapi` |
| Companies House | Matching fallback | Basic auth (API key) | 600/5min | Direct `fetch` |
| DataLedger | Qualification | `x-api-key` header | Credit-based | Direct `fetch` |
| OpenRouter | Entity extraction, CA analysis, email generation | Bearer token | Per-model | `openai` SDK (OpenAI-compatible) |
| OpenAI | Embeddings for vector store queries | API key | Standard | `openai` |
| Supabase | Vector store (CA knowledge base) | Service role key | Generous | `@supabase/supabase-js` |
| GoHighLevel | Contact push | Private Integration Token | 100/10s | Direct `fetch` |

---

## 6. Interface Contracts

### 6a. Scoring Engine

Ported exactly from WF 02's "CapexIQ Scoring" Code node, with field name unified to `capexiqScore`.

**Input:**
```typescript
interface ScoringInput {
  currentPPE: number;
  previousPPE: number;
  totalAssets: number;
  turnoverRevenue: number;
  sicCode: number | string | null;
}
```

**Output:**
```typescript
interface ScoringResult {
  capexiqScore: number;        // 0-100 (was enhanced_ca_score in n8n)
  ppeScore: number;            // 0-1
  sicScore: number;            // 0-1
  investmentActivityScore: number; // 0-1
  assetIntensityScore: number; // 0-1
  ppeCategory: string;
  opportunityValue: string;
  indicators: string[];
}
```

**Weights:** PPE 50%, Investment Activity 25%, Asset Intensity 15%, SIC 10% — hardcoded, matching the n8n scoring engine exactly.

### 6b. Intake Filters

Ported from WF 1.5's "Pre-process & Filter" Code node, updated for actual Apify CSV format.

1. UK only — `country` (contact location) must be "United Kingdom" or "UK"; fallback to `orgCountry` if `country` is empty
2. SME gate — `orgSize` <= 500 (handles both plain numbers and range strings for robustness)
3. Chain exclusion — 35+ brand blocklist (exact list from n8n workflow: marriott, hilton, ihg, accor, starbucks, tesco, cargill, etc.)
4. Email required — `email` field must be non-empty
5. Domain normalisation — strip protocol, www, trailing path, lowercase from `orgWebsite`
6. Dedup by domain — keep highest-seniority contact. Ranking uses `seniority` field (founder > c_suite > director > manager > entry) with `position` text as tiebreaker (MD > Owner > Founder > CEO > CFO > Director > other)
7. Contact name — use `firstName`/`lastName` directly; fall back to splitting `fullName` only if both are empty

### 6c. Matching Chain

Ported from WF 2a's node sequence.

1. SerpAPI: `site:{domain} "limited" OR "ltd" OR "llp"` (Google UK)
2. SerpAPI AI Mode: "What is the limited name of the company that runs {url}?"
3. LLM extraction: extract company name from AI mode text (OpenRouter, configurable model)
4. SerpAPI: `{extracted name} site:find-and-update.company-information.service.gov.uk`
5. Regex: `/company/([0-9A-Z]{6,8})/` from CH URL
6. **Fallback (NEW):** Companies House API direct search by orgName if steps 1-5 fail

### 6d. Email Generation

Ported from WF 3b's AI Agent node. Uses:
- System prompt from `pipeline_prompts` table (key: `email_generation_system`)
- User prompt from `pipeline_prompts` table (key: `email_generation_user`)
- Supabase vector store for RAG (queried by prospect's industry)
- OpenRouter with configurable model (default: Claude Sonnet 4.6)

**Output schema:** Array of 5 emails, each with: `email_number`, `subject`, `preheader`, `body`, `send_delay_days`, `purpose`

### 6e. GHL Push

All 5 emails pushed with subject + preheader + body per email (15 custom fields), plus contact details, source tag, and website. Uses Private Integration Token auth.

---

## 7. Project Structure

```
capexiq/
├── package.json
├── tsconfig.json
├── railway.json              # Multi-service config
├── Procfile                  # Railway process types
├── .env.example
├── src/
│   ├── index.ts              # Express API + dashboard
│   ├── worker.ts             # BullMQ worker (all queues)
│   ├── cron.ts               # Daily send, retry, summary
│   ├── config/
│   │   └── env.ts            # Validated env vars (zod)
│   ├── db/
│   │   ├── client.ts         # pg Pool
│   │   ├── migrations/
│   │   │   └── 001_initial.sql
│   │   ├── queries.ts        # Parameterised queries
│   │   └── settings.ts       # Read/write pipeline_settings + prompts
│   ├── queue/
│   │   ├── setup.ts          # Queue + worker definitions
│   │   └── handlers/
│   │       ├── intake.ts
│   │       ├── matching.ts
│   │       ├── qualification.ts
│   │       ├── email-generation.ts
│   │       └── ghl-send.ts
│   ├── pipeline/
│   │   ├── intake.ts         # CSV parse, filter, dedup (pure functions)
│   │   ├── matching.ts       # SerpAPI chain + CH fallback
│   │   ├── scoring.ts        # Scoring engine (exact port)
│   │   ├── qualification.ts  # DataLedger → scoring → optional AI
│   │   ├── ai-validation.ts  # CA analysis via configurable model
│   │   └── emails.ts         # RAG + email gen
│   ├── services/
│   │   ├── serpapi.ts
│   │   ├── companies-house.ts
│   │   ├── dataledger.ts
│   │   ├── openrouter.ts     # All LLM calls, model from settings
│   │   ├── supabase.ts       # Vector store queries
│   │   ├── ghl.ts            # GoHighLevel contact push
│   │   └── webhook.ts        # Notification sender
│   ├── prompts/
│   │   ├── defaults/
│   │   │   ├── email-generation-system.txt
│   │   │   ├── email-generation-user.txt
│   │   │   ├── ca-analysis-system.txt
│   │   │   └── ca-analysis-user.txt
│   │   └── schemas.ts        # Output schemas (email sequence, CA analysis)
│   ├── views/                # EJS templates for dashboard
│   │   ├── layout.ejs
│   │   ├── dashboard.ejs     # Pipeline runs overview
│   │   ├── run-detail.ejs    # Single run drill-down
│   │   ├── failures.ejs      # Failed records view
│   │   ├── settings.ejs      # Settings editor
│   │   └── prompts.ejs       # Prompt editor with version history
│   ├── routes/
│   │   ├── upload.ts         # POST /upload
│   │   ├── dashboard.ts      # GET / (dashboard views)
│   │   ├── api.ts            # GET/PUT /api/settings, /api/prompts
│   │   └── health.ts         # GET /health
│   └── utils/
│       ├── filters.ts        # Chain blocklist, UK check, SME gate
│       ├── domain.ts         # Domain normalisation
│       └── seniority.ts      # Title ranking
├── tests/
│   ├── scoring.test.ts
│   ├── filters.test.ts
│   ├── intake.test.ts
│   └── fixtures/
│       └── sample-contacts.csv
└── scripts/
    └── seed-prompts.ts       # Load default prompts into DB
```

---

## 8. Environment Variables

```env
# Railway-provisioned
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# External APIs
SERPAPI_KEY=
COMPANIES_HOUSE_API_KEY=
DATALEDGER_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=

# Supabase (existing vector store)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# GoHighLevel
GHL_PRIVATE_TOKEN=
GHL_LOCATION_ID=
GHL_CUSTOM_FIELD_EMAIL_1_SUBJECT=
GHL_CUSTOM_FIELD_EMAIL_1_BODY=
GHL_CUSTOM_FIELD_EMAIL_1_PREHEADER=
GHL_CUSTOM_FIELD_EMAIL_2_SUBJECT=
GHL_CUSTOM_FIELD_EMAIL_2_BODY=
GHL_CUSTOM_FIELD_EMAIL_2_PREHEADER=
GHL_CUSTOM_FIELD_EMAIL_3_SUBJECT=
GHL_CUSTOM_FIELD_EMAIL_3_BODY=
GHL_CUSTOM_FIELD_EMAIL_3_PREHEADER=
GHL_CUSTOM_FIELD_EMAIL_4_SUBJECT=
GHL_CUSTOM_FIELD_EMAIL_4_BODY=
GHL_CUSTOM_FIELD_EMAIL_4_PREHEADER=
GHL_CUSTOM_FIELD_EMAIL_5_SUBJECT=
GHL_CUSTOM_FIELD_EMAIL_5_BODY=
GHL_CUSTOM_FIELD_EMAIL_5_PREHEADER=

# App
PORT=3000
NODE_ENV=production
```

All runtime-configurable values (thresholds, models, rate limits, daily cap, webhook URL) live in `pipeline_settings` — not env vars.

---

## 9. Observable Truths

These must be true when the system is complete:

1. **Upload a 10-row CSV → all 10 records have a terminal status within 10 minutes**
   Verification: `SELECT status, count(*) FROM processed_companies WHERE pipeline_run_id = X GROUP BY status`
   Expected: Every record is in one of: sent, ready_to_send, no_match, filtered, duplicate, or failed_*

2. **No record has status 'pending' for more than 1 hour (at normal queue depths)**
   Verification: `SELECT * FROM processed_companies WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'`
   Expected: Empty result set

3. **Daily send limit is respected**
   Verification: `SELECT count(*) FROM processed_companies WHERE sent_at::date = CURRENT_DATE`
   Expected: <= `daily_send_limit` setting value

4. **Changing a setting takes effect on the next job without restart**
   Verification: Update `ai_validation_threshold` to 90 via dashboard, process a record scoring 60 — it should skip AI validation

5. **Failed records have actionable error detail**
   Verification: `SELECT error_log FROM processed_companies WHERE status LIKE 'failed_%' LIMIT 5`
   Expected: Each has JSON with `{ message, stage, timestamp, attempt }`

6. **Webhook fires with daily summary**
   Verification: Set `webhook_url` to a RequestBin/webhook.site URL, wait for Cron run
   Expected: POST received with pipeline stats

7. **Prompt changes apply to next email generation**
   Verification: Edit email_generation_system prompt, process a new record, check `prompt_version_id` on the result
   Expected: Points to the new prompt version

---

## 10. Falsifiable Assumptions

| # | Assumption | Verification | Result |
|---|-----------|-------------|--------|
| 1 | Railway Postgres supports pgvector extension | Not needed — keeping Supabase for vector store | N/A |
| 2 | BullMQ rate limiting works per-queue | BullMQ docs confirm `limiter: { max, duration }` per queue | VERIFIED |
| 3 | OpenRouter supports all three target models | Check OpenRouter model list for gpt-4o-mini, kimi-k2.5, claude-sonnet-4 | TO VERIFY at build time |
| 4 | Supabase can be accessed from Railway (no IP restrictions) | Supabase allows connections from any IP by default | VERIFIED |
| 5 | GHL Private Integration Token supports contact create + custom fields | GHL API docs confirm `/contacts/` endpoint with customFields | VERIFIED |
| 6 | Railway Cron supports daily scheduling | Railway docs confirm cron expressions on services | VERIFIED |
| 7 | SerpAPI AI Mode is available via the `serpapi` npm package | Need to verify — this is a newer SerpAPI feature | TO VERIFY at build time |
| 8 | 150 GHL pushes/day is within rate limits (100/10s limit) | 150/day = ~6/hour if spread evenly, well within 100/10s | VERIFIED |

---

## 11. Build Phases

### Phase 1 — Foundation
1. Scaffold TypeScript project (package.json, tsconfig, eslint)
2. Environment config with zod validation
3. PostgreSQL schema migration (all tables from section 4)
4. Redis + BullMQ setup (queue definitions, no handlers yet)
5. Express with health check endpoint
6. Seed script for default settings and prompts
7. Deploy skeleton to Railway (API service only initially)

### Phase 2 — Core Business Logic
8. CSV parsing (handle Pipeline Labs + Apify formats)
9. Intake filters (UK, SME, chain blocklist, email required)
10. Domain normalisation + seniority ranking + dedup
11. Scoring engine (exact port from n8n, unified field name)
12. Opportunity value estimation
13. Unit tests for filters, scoring, dedup

### Phase 3 — External API Services
14. SerpAPI service (domain search, AI mode, CH search)
15. Companies House API service (fallback)
16. DataLedger service (financials extraction)
17. OpenRouter service (LLM wrapper, model from settings, prompt from DB)
18. Supabase service (vector store queries)
19. GoHighLevel service (contact create/update, all 15 custom fields)
20. Webhook notification service

### Phase 4 — Pipeline Wiring
21. Intake handler (CSV → filter → dedup → enqueue matching jobs)
22. Matching handler (SerpAPI chain → CH fallback → update record)
23. Qualification handler (DataLedger → scoring → conditional AI validation → update record)
24. Email generation handler (build context → RAG → LLM → store emails → status: ready_to_send)
25. GHL send handler (push contact + emails → mark sent)
26. Error handling: retry logic, error_log population, status transitions
27. Queue event wiring (job completion → enqueue next stage)

### Phase 5 — Dashboard & API
28. EJS layout + dashboard view (pipeline runs table with status counts)
29. Run detail view (drill into individual records, filter by status)
30. Failures view (all failed records with error detail, retry button)
31. Settings editor (all pipeline_settings, save via API)
32. Prompt editor (view current, edit, version history, rollback)
33. CSV upload page (form + progress indication)

### Phase 6 — Cron & Notifications
34. Daily GHL send job (pick ready_to_send up to daily limit, push, mark sent)
35. Retry job (re-enqueue retriable failures)
36. Daily summary webhook (stats + failure count + action needed)
37. Railway multi-service deployment (API, Worker, Cron)

---

## 12. Wiring Requirements (Failure Prevention)

| Concern | Action |
|---------|--------|
| New tables | Migration file `001_initial.sql` with all DDL |
| Default data | Seed script for `pipeline_settings` and `pipeline_prompts` defaults |
| Express routes | All routes registered in `index.ts` via `app.use()` |
| BullMQ workers | All queue handlers registered in `worker.ts` |
| Cron jobs | Cron service entry point in `cron.ts`, Railway cron config |
| Environment | `.env.example` documents all required vars, zod validates at startup |
| GHL custom fields | All 15 field IDs (5 subjects + 5 bodies + 5 preheaders) in env vars |
| Prompt defaults | Default prompts stored in `src/prompts/defaults/*.txt`, loaded by seed script |

---

## 13. What This Spec Does NOT Cover (Future Work)

- A/B testing (prompt weights) — add when needed
- Multiple CSV format parsers — start with Pipeline Labs format, add Apify later if different
- User authentication — single user, no auth needed
- Custom domain — use Railway's default domain
- Email sending from the app — GHL handles actual email delivery
- Analytics/reporting beyond the dashboard — can add later
- Knowledge base management UI — manage Supabase content directly for now
