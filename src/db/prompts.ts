import { query } from './client.js';

export interface Prompt {
  id: number;
  key: string;
  content: string;
  version: number;
  is_active: boolean;
  created_at: string;
  notes: string | null;
}

export async function getActivePrompt(key: string): Promise<Prompt | null> {
  const result = await query<Prompt>(
    'SELECT * FROM pipeline_prompts WHERE key = $1 AND is_active = true',
    [key]
  );
  return result.rows[0] || null;
}

export async function savePrompt(key: string, content: string, notes?: string): Promise<Prompt> {
  // Deactivate current active prompt for this key
  await query(
    'UPDATE pipeline_prompts SET is_active = false WHERE key = $1 AND is_active = true',
    [key]
  );

  // Get next version number
  const versionResult = await query<{ max_version: number }>(
    'SELECT COALESCE(MAX(version), 0) as max_version FROM pipeline_prompts WHERE key = $1',
    [key]
  );
  const nextVersion = versionResult.rows[0].max_version + 1;

  const result = await query<Prompt>(
    `INSERT INTO pipeline_prompts (key, content, version, is_active, notes)
     VALUES ($1, $2, $3, true, $4)
     RETURNING *`,
    [key, content, nextVersion, notes || null]
  );

  return result.rows[0];
}

export async function getPromptHistory(key: string): Promise<Prompt[]> {
  const result = await query<Prompt>(
    'SELECT * FROM pipeline_prompts WHERE key = $1 ORDER BY version DESC',
    [key]
  );
  return result.rows;
}

export async function activatePrompt(id: number): Promise<Prompt | null> {
  // Get the prompt to find its key
  const promptResult = await query<Prompt>(
    'SELECT * FROM pipeline_prompts WHERE id = $1',
    [id]
  );
  if (promptResult.rows.length === 0) return null;

  const prompt = promptResult.rows[0];

  // Deactivate current active for this key
  await query(
    'UPDATE pipeline_prompts SET is_active = false WHERE key = $1 AND is_active = true',
    [prompt.key]
  );

  // Activate the specified prompt
  await query(
    'UPDATE pipeline_prompts SET is_active = true WHERE id = $1',
    [id]
  );

  return { ...prompt, is_active: true };
}
