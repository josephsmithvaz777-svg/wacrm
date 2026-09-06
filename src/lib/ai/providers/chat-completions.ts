import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * OpenAI-compatible Chat Completions (OpenAI, DeepSeek, …). The
 * token-cap field differs: newer OpenAI models want
 * `max_completion_tokens`; DeepSeek still uses `max_tokens`.
 */
export async function generateChatCompletions(
  args: ProviderArgs & {
    url: string
    label: string
    maxTokensField: 'max_tokens' | 'max_completion_tokens'
  },
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, url, label, maxTokensField } =
    args

  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...mergeConsecutive(messages),
    ],
  }
  payload[maxTokensField] = MAX_OUTPUT_TOKENS

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(label, res)
  }

  const data = (await res.json().catch(() => null)) as ChatCompletionsResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${label} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
