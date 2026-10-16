/**
 * Model configuration from server secrets only:
 *   LLM_BASE_URL  any OpenAI-compatible endpoint (default https://api.openai.com/v1)
 *   LLM_API_KEY   never shipped to the browser
 *   LLM_MODEL     e.g. gpt-4.1-mini; switch models without a deploy of the site
 *   LLM_TOOL_MODE auto | tools | json  (json = providers without tool calling)
 */
import OpenAI from 'openai';
import type {ChatClient} from './agent.ts';

export type LlmConfig = {chat: ChatClient | null; model: string; toolMode: 'auto' | 'tools' | 'json'; tenantDailyTokens: number; globalDailyTokens: number};

export function llmFromEnv(get: (k: string) => string | undefined): LlmConfig {
  const key = get('LLM_API_KEY');
  const model = get('LLM_MODEL') ?? 'gpt-4.1-mini';
  const mode = (get('LLM_TOOL_MODE') ?? 'auto') as LlmConfig['toolMode'];
  const tenantDailyTokens = Number(get('LLM_DAILY_TOKENS_PER_TENANT') ?? 200_000);
  const globalDailyTokens = Number(get('LLM_DAILY_TOKENS_GLOBAL') ?? 2_000_000);
  if (!key) return {chat: null, model, toolMode: mode, tenantDailyTokens, globalDailyTokens};
  const openai = new OpenAI({apiKey: key, baseURL: get('LLM_BASE_URL') || undefined, timeout: 20_000, maxRetries: 1});
  const chat: ChatClient = {
    create: params => openai.chat.completions.create(params as never) as never,
  };
  return {chat, model, toolMode: ['auto', 'tools', 'json'].includes(mode) ? mode : 'auto', tenantDailyTokens, globalDailyTokens};
}
