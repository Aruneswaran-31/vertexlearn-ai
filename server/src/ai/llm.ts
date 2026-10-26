import { env } from '../env.js';

export type ClaudeResult = { text: string; model: string } | null;

/**
 * Optional Claude generation. When ANTHROPIC_API_KEY is absent (the default for
 * local demo use) every AI feature falls back to the deterministic grounded
 * engine, so the product works without an external dependency.
 */
export async function callClaude(options: {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<ClaudeResult> {
  if (!env.anthropicApiKey) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.anthropicModel,
        max_tokens: options.maxTokens ?? 900,
        temperature: options.temperature ?? 0.3,
        system: options.system,
        messages: [{ role: 'user', content: options.prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.warn('[vertexlearn] Claude request failed', response.status, await response.text());
      return null;
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim();

    return text ? { text, model: env.anthropicModel } : null;
  } catch (error) {
    console.warn('[vertexlearn] Claude request error', error);
    return null;
  }
}

export function aiEngineName(): 'claude' | 'local' {
  return env.anthropicApiKey ? 'claude' : 'local';
}
