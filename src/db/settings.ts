import { query } from './client.js';

// In-memory cache with TTL
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const result = await query<{ value: string }>(
    'SELECT value FROM pipeline_settings WHERE key = $1',
    [key]
  );

  if (result.rows.length === 0) return null;

  const value = result.rows[0].value;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const val = await getSetting(key);
  if (val === null) return fallback;
  const num = Number(val);
  return Number.isNaN(num) ? fallback : num;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO pipeline_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
  cache.delete(key);
}

export async function getAllSettings(): Promise<Record<string, { value: string; description: string | null; updated_at: string }>> {
  const result = await query<{ key: string; value: string; description: string | null; updated_at: string }>(
    'SELECT key, value, description, updated_at FROM pipeline_settings ORDER BY key'
  );
  const settings: Record<string, { value: string; description: string | null; updated_at: string }> = {};
  for (const row of result.rows) {
    settings[row.key] = { value: row.value, description: row.description, updated_at: row.updated_at };
  }
  return settings;
}

export function clearSettingsCache(): void {
  cache.clear();
}
