import { loadWorkerEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { createWorker, QUEUE_NAMES } from './queue/setup.js';
import { handleIntake } from './queue/handlers/intake.js';
import { handleMatching } from './queue/handlers/matching.js';
import { handleQualification } from './queue/handlers/qualification.js';
import { handleEmailGeneration } from './queue/handlers/email-generation.js';
import { handleGHLSend } from './queue/handlers/ghl-send.js';
import { getSettingNumber } from './db/settings.js';

const env = loadWorkerEnv();

async function start() {
  console.log('[worker] Running migrations...');
  await runMigrations();

  // Read rate limits from settings (with fallback defaults)
  const matchingRate = await getSettingNumber('matching_rate_limit_ms', 3000);
  const qualRate = await getSettingNumber('qualification_rate_limit_ms', 2500);
  const emailRate = await getSettingNumber('email_generation_rate_limit_ms', 10000);

  // Intake worker — no rate limit (processes one CSV at a time)
  const intakeWorker = createWorker(
    QUEUE_NAMES.INTAKE,
    async (job) => handleIntake(job),
    { concurrency: 1 }
  );

  // Matching worker — rate limited (3 SerpAPI calls per record)
  const matchingWorker = createWorker(
    QUEUE_NAMES.MATCHING,
    async (job) => handleMatching(job, {
      SERPAPI_KEY: env.SERPAPI_KEY,
      COMPANIES_HOUSE_API_KEY: env.COMPANIES_HOUSE_API_KEY,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    }),
    { concurrency: 1, limiter: { max: 1, duration: matchingRate } }
  );

  // Qualification worker — rate limited (DataLedger + optional AI)
  const qualificationWorker = createWorker(
    QUEUE_NAMES.QUALIFICATION,
    async (job) => handleQualification(job, {
      DATALEDGER_API_KEY: env.DATALEDGER_API_KEY,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    }),
    { concurrency: 1, limiter: { max: 1, duration: qualRate } }
  );

  // Email generation worker — rate limited (OpenRouter + Supabase)
  const emailWorker = createWorker(
    QUEUE_NAMES.EMAIL_GENERATION,
    async (job) => handleEmailGeneration(job, {
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    { concurrency: 1, limiter: { max: 1, duration: emailRate } }
  );

  // GHL send worker — used by Cron, no rate limit here (Cron controls volume)
  const ghlWorker = createWorker(
    QUEUE_NAMES.GHL_SEND,
    async (job) => handleGHLSend(job, env as unknown as Record<string, string>),
    { concurrency: 1 }
  );

  const workers = [intakeWorker, matchingWorker, qualificationWorker, emailWorker, ghlWorker];

  // Log worker events
  for (const worker of workers) {
    worker.on('completed', (job) => {
      console.log(`[worker] ${worker.name} completed job ${job.id}`);
    });
    worker.on('failed', (job, err) => {
      console.error(`[worker] ${worker.name} failed job ${job?.id}:`, err.message);
    });
  }

  console.log('[worker] All queue workers started');
  console.log(`[worker] Rate limits — matching: ${matchingRate}ms, qualification: ${qualRate}ms, email: ${emailRate}ms`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    await Promise.all(workers.map((w) => w.close()));
    console.log('[worker] All workers closed');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[worker] Failed to start:', err);
  process.exit(1);
});
