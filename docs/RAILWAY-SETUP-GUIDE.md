# CapexIQ — Railway Setup Guide

Step-by-step guide to deploy CapexIQ on Railway from scratch.

---

## Prerequisites

- A Railway account (https://railway.app)
- Your GitHub repo connected to Railway
- API keys ready for: SerpAPI, Companies House, DataLedger, OpenRouter, OpenAI, Supabase, GoHighLevel

---

## Step 1: Create the Railway Project

1. Log into Railway → **New Project** → **Deploy from GitHub repo**
2. Select `gregdickson/capex-iq`
3. Railway will auto-detect Node.js and start a build — **let it fail for now** (it needs env vars and databases first)

---

## Step 2: Provision PostgreSQL

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway creates a Postgres instance and auto-generates a `DATABASE_URL`
3. Click the Postgres service → **Variables** tab → copy the `DATABASE_URL` value (you'll need it in Step 5)

---

## Step 3: Provision Redis

1. In your Railway project, click **+ New** → **Database** → **Redis**
2. Railway creates a Redis instance and auto-generates a `REDIS_URL`
3. Copy the `REDIS_URL` value

---

## Step 4: Create the Three Services

You need 3 separate services running from the same repo. Railway calls these "services."

### Service 1: API (the web dashboard)

This was auto-created in Step 1. Click on it and configure:

1. **Settings** tab:
   - **Builder:** Nixpacks (default — handles `npm install` and `npm run build` automatically)
   - **Start Command:** `npm run start:api`
   - **Watch Paths:** leave default (rebuilds on any push)
2. **Networking** tab:
   - Click **Generate Domain** — this gives you a public URL (e.g., `capexiq-production.up.railway.app`)

> **Note:** Nixpacks is Railway's default builder. It automatically detects Node.js, runs `npm install`, then runs the `build` script from `package.json` during the build phase. You only need to set the **start command** — don't prepend `npm run build &&` because Nixpacks already built it.

### Service 2: Worker (processes pipeline jobs)

1. In the project, click **+ New** → **GitHub Repo** → select `capex-iq` again
2. Railway creates a second service from the same repo
3. Rename it to **Worker** (click the service name)
4. **Settings** tab:
   - **Start Command:** `npm run start:worker`
5. **Networking** tab:
   - Do NOT generate a domain — the worker doesn't need public access

### Service 3: Cron (daily sends + retries + summary)

1. Click **+ New** → **GitHub Repo** → select `capex-iq` again
2. Rename to **Cron**
3. **Settings** tab:
   - **Start Command:** `npm run start:cron`
   - **Cron Schedule:** `0 */1 * * *` (every hour) or `0 8 * * *` (once daily at 8am UTC)
   - **Restart Policy:** Do not restart (it runs once and exits)

---

## Step 5: Set Environment Variables

You need to set the same env vars on **all three services** (API, Worker, Cron). The easiest way:

1. Click on the **API** service → **Variables** tab
2. Click **Raw Editor** and paste all variables at once:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
SERPAPI_KEY=your_serpapi_key_here
COMPANIES_HOUSE_API_KEY=your_ch_api_key_here
DATALEDGER_API_KEY=your_dataledger_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
OPENAI_API_KEY=your_openai_key_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GHL_PRIVATE_TOKEN=your_ghl_private_integration_token
GHL_LOCATION_ID=your_ghl_location_id
GHL_CUSTOM_FIELD_EMAIL_1_SUBJECT=field_id_here
GHL_CUSTOM_FIELD_EMAIL_1_BODY=field_id_here
GHL_CUSTOM_FIELD_EMAIL_1_PREHEADER=field_id_here
GHL_CUSTOM_FIELD_EMAIL_2_SUBJECT=field_id_here
GHL_CUSTOM_FIELD_EMAIL_2_BODY=field_id_here
GHL_CUSTOM_FIELD_EMAIL_2_PREHEADER=field_id_here
GHL_CUSTOM_FIELD_EMAIL_3_SUBJECT=field_id_here
GHL_CUSTOM_FIELD_EMAIL_3_BODY=field_id_here
GHL_CUSTOM_FIELD_EMAIL_3_PREHEADER=field_id_here
GHL_CUSTOM_FIELD_EMAIL_4_SUBJECT=field_id_here
GHL_CUSTOM_FIELD_EMAIL_4_BODY=field_id_here
GHL_CUSTOM_FIELD_EMAIL_4_PREHEADER=field_id_here
GHL_CUSTOM_FIELD_EMAIL_5_SUBJECT=field_id_here
GHL_CUSTOM_FIELD_EMAIL_5_BODY=field_id_here
GHL_CUSTOM_FIELD_EMAIL_5_PREHEADER=field_id_here
PORT=3000
NODE_ENV=production
```

**Important notes:**
- `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}` are Railway reference variables — they auto-resolve to the real connection strings. Use this exact syntax.
- The `PORT` variable is only needed on the API service. Railway auto-assigns ports but the app listens on 3000.

3. **Copy the same variables** to the Worker and Cron services:
   - Click Worker → Variables → Raw Editor → paste the same block
   - Click Cron → Variables → Raw Editor → paste the same block

### Where to find the GHL custom field IDs

1. In GoHighLevel, go to **Settings** → **Custom Fields**
2. You need 15 custom fields created (or already existing):
   - `email_1_subject`, `email_1_body`, `email_1_preheader`
   - `email_2_subject`, `email_2_body`, `email_2_preheader`
   - `email_3_subject`, `email_3_body`, `email_3_preheader`
   - `email_4_subject`, `email_4_body`, `email_4_preheader`
   - `email_5_subject`, `email_5_body`, `email_5_preheader`
3. Click each field → copy its **Field ID** (a string like `dTz8a7SToBGt8OysrW0i`)
4. Paste each ID into the corresponding env var

---

## Step 6: Deploy

1. Once env vars are set on all 3 services, **redeploy** each one:
   - Click the service → **Deployments** tab → **Redeploy** (or just push a commit)
2. The API service will:
   - Build the TypeScript
   - Run database migrations automatically on startup
   - Start the Express server

### Verify the API is running

Visit your Railway domain (from Step 4):
- `https://your-domain.up.railway.app/health` — should return `{"status":"ok","db":"connected","redis":"connected"}`
- `https://your-domain.up.railway.app/` — should show the empty dashboard

---

## Step 7: Seed Default Prompts

The default prompts need to be loaded into the database. You can do this via Railway's **one-off command** feature:

1. Click the **API** service → **Settings** → scroll to **Railway CLI** section
2. Or use the Railway CLI locally:

```bash
# Install Railway CLI if you haven't
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run the seed script
railway run npm run seed
```

You should see:
```
[seed] Checking pipeline_settings...
[seed] 11 settings found (inserted via migration)
[seed] Seeded prompt "email_generation_system" from email-generation-system.txt
[seed] Seeded prompt "email_generation_user" from email-generation-user.txt
[seed] Seeded prompt "ca_analysis_system" from ca-analysis-system.txt
[seed] Seeded prompt "ca_analysis_user" from ca-analysis-user.txt
[seed] Done
```

---

## Step 8: Configure Your Settings

1. Visit `https://your-domain.up.railway.app/settings`
2. Review and adjust:
   - **Daily GHL Send Limit:** 150 (default) — how many contacts pushed to GHL per day
   - **AI Validation Threshold:** 55 (default) — score above which the expensive AI validation runs
   - **Reprocess Window:** 90 days (default) — prevents re-processing the same domain
   - **Webhook URL:** paste a Slack webhook, Zapier URL, or webhook.site URL for testing
   - **Webhook Enabled:** set to Enabled once you've configured the URL
3. Click **Save Settings**

---

## Step 9: Test with a Small Upload

1. Take 5-10 rows from your Apify CSV and save as a small test file
2. Visit `https://your-domain.up.railway.app/upload`
3. Upload the test CSV
4. Go to the **Dashboard** — a new run should appear
5. Watch the status counts update as the Worker processes records:
   - Records move through: `pending` → `matching` → `matched` → `qualifying` → `scored` → `generating_emails` → `ready_to_send`
   - Failed records show in the **Failures** tab with error detail
6. The Cron will pick up `ready_to_send` records on its next scheduled run and push them to GHL

---

## Step 10: Go Live

Once you're happy with the test:

1. Upload your full Apify CSV
2. The pipeline will process all records at the configured rate limits
3. The Cron will drip-feed 150/day (or your configured limit) into GHL
4. Check the dashboard daily, or rely on the webhook summary

---

## Ongoing Operations

### Adjust daily send volume
Settings → change **Daily GHL Send Limit** → Save. Takes effect on the next Cron run.

### Change scoring threshold
Settings → change **AI Validation Threshold** → Save. Takes effect on the next qualification job.

### Swap LLM models
Settings → change any model field (e.g., `anthropic/claude-sonnet-4-20250514` to another OpenRouter model) → Save. Takes effect on the next job.

### Edit email prompts
Prompts → select a prompt tab → edit in the textarea → Save New Version. Previous versions are kept for rollback.

### Retry failed records
Failures → click **Retry** on any failed record. It re-enters the pipeline at the stage where it failed.

### Check pipeline health
`GET /health` returns DB/Redis connectivity and queue depths. Useful for uptime monitoring.

---

## Cost Estimates

| Service | Railway Cost |
|---------|-------------|
| API (web) | ~$5/month (low traffic, single user) |
| Worker (always-on) | ~$5-10/month (depends on queue volume) |
| Cron | ~$1/month (runs briefly on schedule) |
| PostgreSQL | ~$5/month (Starter plan) |
| Redis | ~$5/month (Starter plan) |
| **Total Railway** | **~$20-25/month** |

External API costs depend on volume:
- SerpAPI: 3 calls per matched record
- DataLedger: 1 call per qualified record (credit-based)
- OpenRouter: varies by model (Kimi K2.5 for CA analysis, Claude for emails)
- OpenAI: embeddings for RAG queries (very cheap)

---

## Troubleshooting

### API service won't start
- Check **Deployments** → click the failed deploy → read the build log
- Most common: missing env var. The app fails fast with a clear message listing which vars are missing.

### Worker not processing jobs
- Check the Worker service is running (green status in Railway)
- Check `/health` — verify Redis is connected
- Check queue depths: if jobs are stuck in "waiting", the Worker may have crashed and restarted

### Cron not sending to GHL
- Check the Cron service logs (Deployments → latest run)
- Verify `daily_send_limit` hasn't been reached for today
- Verify there are records with `ready_to_send` status in the dashboard

### GHL push failing
- Check the error detail in Failures view
- Most common: invalid custom field IDs, expired token, or rate limit hit
- GHL rate limit is 100 requests per 10 seconds — the Cron sends sequentially so this shouldn't trigger unless something is misconfigured
