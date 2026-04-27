import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

let supabase: SupabaseClient | null = null;
let openai: OpenAI | null = null;

function getSupabase(url: string, key: string): SupabaseClient {
  if (!supabase) {
    supabase = createClient(url, key);
  }
  return supabase;
}

function getOpenAI(apiKey: string): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export interface KnowledgeChunk {
  id: number;
  content: string;
  metadata: Record<string, any> | null;
  similarity: number;
}

export async function queryKnowledgeBase(options: {
  query: string;
  supabaseUrl: string;
  supabaseKey: string;
  openaiKey: string;
  limit?: number;
}): Promise<KnowledgeChunk[]> {
  const { query, supabaseUrl, supabaseKey, openaiKey, limit = 5 } = options;

  // Generate embedding for the query
  const ai = getOpenAI(openaiKey);
  const embeddingResponse = await ai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: query,
  });
  const embedding = embeddingResponse.data[0].embedding;

  // Query Supabase vector store
  const sb = getSupabase(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc('match_capital_allowances_knowledge', {
    query_embedding: embedding,
    match_threshold: 0.7,
    match_count: limit,
  });

  if (error) {
    // Fallback: try direct table query if RPC doesn't exist
    console.warn('[supabase] RPC match function not found, trying direct query');
    const { data: directData, error: directError } = await sb
      .from('capital_allowances_knowledge')
      .select('id, content, metadata')
      .limit(limit);

    if (directError) {
      throw new Error(`Supabase query failed: ${directError.message}`);
    }

    return (directData || []).map((row: any) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      similarity: 0,
    }));
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    content: row.content,
    metadata: row.metadata,
    similarity: row.similarity,
  }));
}
