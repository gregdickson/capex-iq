import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(apiKey: string): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });
  }
  return client;
}

export interface CompletionOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema?: Record<string, any>;
  apiKey: string;
}

export async function complete(options: CompletionOptions): Promise<string> {
  const openai = getClient(options.apiKey);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.userPrompt },
  ];

  const requestOptions: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: options.model,
    messages,
  };

  // Use structured output if schema provided
  if (options.schema) {
    requestOptions.response_format = {
      type: 'json_schema',
      json_schema: options.schema,
    } as any;
  }

  const response = await openai.chat.completions.create(requestOptions);
  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error(`Empty response from ${options.model}`);
  }

  return content;
}

export async function completeJSON<T = any>(options: CompletionOptions): Promise<T> {
  const raw = await complete(options);

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }
    throw new Error(`Failed to parse JSON response from ${options.model}: ${raw.substring(0, 200)}`);
  }
}
