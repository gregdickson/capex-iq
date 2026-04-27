import { z } from 'zod';

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

const apiKeysSchema = z.object({
  SERPAPI_KEY: z.string().min(1),
  COMPANIES_HOUSE_API_KEY: z.string().min(1),
  DATALEDGER_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const ghlSchema = z.object({
  GHL_PRIVATE_TOKEN: z.string().default(''),
  GHL_LOCATION_ID: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_1_SUBJECT: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_1_BODY: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_1_PREHEADER: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_2_SUBJECT: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_2_BODY: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_2_PREHEADER: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_3_SUBJECT: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_3_BODY: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_3_PREHEADER: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_4_SUBJECT: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_4_BODY: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_4_PREHEADER: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_5_SUBJECT: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_5_BODY: z.string().default(''),
  GHL_CUSTOM_FIELD_EMAIL_5_PREHEADER: z.string().default(''),
});

const apiSchema = baseSchema.extend({
  PORT: z.coerce.number().default(3000),
  API_KEY: z.string().min(1),
});

const workerSchema = baseSchema.merge(apiKeysSchema).merge(ghlSchema);

const cronSchema = baseSchema.merge(ghlSchema);

type ApiEnv = z.infer<typeof apiSchema>;
type WorkerEnv = z.infer<typeof workerSchema>;
type CronEnv = z.infer<typeof cronSchema>;

function loadEnv<T>(schema: z.ZodType<T>, label: string): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`
    );
    console.error(`\n[${label}] Missing or invalid environment variables:\n${missing.join('\n')}\n`);
    process.exit(1);
  }
  return result.data;
}

export function loadApiEnv(): ApiEnv {
  return loadEnv(apiSchema, 'API');
}

export function loadWorkerEnv(): WorkerEnv {
  return loadEnv(workerSchema, 'Worker');
}

export function loadCronEnv(): CronEnv {
  return loadEnv(cronSchema, 'Cron');
}

export type { ApiEnv, WorkerEnv, CronEnv };
