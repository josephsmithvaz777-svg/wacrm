import type { ProviderResult } from '../types'
import { generateChatCompletions } from './chat-completions'
import type { ProviderArgs } from './shared'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

/**
 * DeepSeek's Chat Completions API is OpenAI-compatible. We hit their
 * host with the account's BYO key and `max_tokens` (their documented
 * cap field — `max_completion_tokens` is ignored/rejected).
 */
export async function generateDeepSeek(args: ProviderArgs): Promise<ProviderResult> {
  return generateChatCompletions({
    ...args,
    url: DEEPSEEK_URL,
    label: 'DeepSeek',
    maxTokensField: 'max_tokens',
  })
}
