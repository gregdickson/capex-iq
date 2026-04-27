import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../src/db/client.js';
import { getActivePrompt, savePrompt } from '../src/db/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS_DIR = path.join(__dirname, '..', 'src', 'prompts', 'defaults');

const PROMPT_KEYS = [
  'email_generation_system',
  'email_generation_user',
  'ca_analysis_system',
  'ca_analysis_user',
];

async function seed() {
  console.log('[seed] Checking pipeline_settings...');
  const settingsResult = await query('SELECT count(*)::int as count FROM pipeline_settings');
  console.log(`[seed] ${settingsResult.rows[0].count} settings found (inserted via migration)`);

  console.log('[seed] Seeding default prompts...');
  for (const key of PROMPT_KEYS) {
    const existing = await getActivePrompt(key);
    if (existing) {
      console.log(`[seed] Prompt "${key}" already exists (v${existing.version}), skipping`);
      continue;
    }

    const filename = `${key.replace(/_/g, '-')}.txt`;
    const filepath = path.join(DEFAULTS_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.log(`[seed] No default file for "${key}" at ${filename}, creating placeholder`);
      await savePrompt(key, `[Placeholder for ${key}]`, 'Auto-seeded placeholder');
      continue;
    }

    const content = fs.readFileSync(filepath, 'utf-8').trim();
    await savePrompt(key, content, 'Default prompt from seed');
    console.log(`[seed] Seeded prompt "${key}" from ${filename}`);
  }

  console.log('[seed] Done');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
