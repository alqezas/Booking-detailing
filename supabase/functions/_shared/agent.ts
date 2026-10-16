/**
 * Bounded assistant loop.
 *
 *   mode "tools": the first model turn MUST call a tool (tool_choice
 *                 "required"), so every answer is grounded in data fetched
 *                 by our server functions. At most `maxRounds` tool rounds.
 *   mode "json":  for providers without tool calling — the model returns a
 *                 JSON intent, we validate it, run the tool ourselves, then
 *                 ask the model to phrase the answer from that data only.
 *   fallback:     no model / model error / budget exhausted — the
 *                 deterministic router picks the tool and a template answers.
 *
 * The model never sees a tenant id, never writes SQL and never gets a tool
 * outside its scope (validateCall rejects it).
 */
import {toolDefinitions, validateCall, type Executor, type Scope} from './tools.ts';

export type ChatMessage =
  | {role: 'system' | 'user'; content: string}
  | {role: 'assistant'; content: string | null; tool_calls?: ToolCall[]}
  | {role: 'tool'; tool_call_id: string; content: string};
export type ToolCall = {id: string; type: 'function'; function: {name: string; arguments: string}};

/** The slice of the OpenAI SDK the agent uses (chat.completions.create). */
export type ChatClient = {
  create(params: {
    model: string;
    messages: ChatMessage[];
    tools?: ReturnType<typeof toolDefinitions>;
    tool_choice?: 'auto' | 'required' | 'none';
    response_format?: {type: 'json_object'};
    max_tokens?: number;
    temperature?: number;
  }): Promise<{choices: {message: {content: string | null; tool_calls?: ToolCall[]}}[]; usage?: {total_tokens?: number}}>;
};

export type AgentReply = {
  text: string;
  mode: 'tools' | 'json' | 'fallback';
  tools: string[];
  /** Optional structured payload for the UI (e.g. slots to tap). */
  data?: unknown;
  notice?: string;
};

export type AgentOptions = {
  scope: Scope;
  system: string;
  history: {role: 'user' | 'assistant'; content: string}[];
  user: string;
  execute: Executor;
  fallback: (reason: string) => Promise<AgentReply>;
  chat: ChatClient | null;
  model: string;
  toolMode: 'tools' | 'json' | 'auto';
  maxRounds?: number;
  maxTokens?: number;
  /** Called before every model call; return false to stop (budget). */
  reserve?: (estimatedTokens: number) => Promise<boolean>;
  settle?: (reserved: number, used: number) => Promise<void>;
};

export class BudgetExceeded extends Error {}
class ToolsUnsupported extends Error {}

const estimate = (messages: ChatMessage[], maxTokens: number) =>
  Math.ceil(messages.reduce((n, m) => n + (('content' in m && m.content) || '').length, 0) / 3) + maxTokens + 200;

export async function runAgent(o: AgentOptions): Promise<AgentReply> {
  if (!o.chat) return o.fallback('no-model');
  const maxTokens = o.maxTokens ?? 500;
  const call: ChatClient['create'] = async params => {
    const est = estimate(params.messages, maxTokens);
    if (o.reserve && !(await o.reserve(est))) throw new BudgetExceeded('budget');
    const r = await o.chat!.create({...params, max_tokens: maxTokens, temperature: 0.2});
    await o.settle?.(est, r.usage?.total_tokens ?? est);
    return r;
  };

  const base: ChatMessage[] = [{role: 'system', content: o.system}, ...o.history.slice(-8), {role: 'user', content: o.user}];

  try {
    if (o.toolMode !== 'json') {
      try {
        return await toolLoop(o, call, base);
      } catch (e) {
        if (!(e instanceof ToolsUnsupported) || o.toolMode === 'tools') throw e;
      }
    }
    return await jsonIntent(o, call, base);
  } catch (e) {
    return o.fallback(e instanceof BudgetExceeded ? 'budget' : 'model-error');
  }
}

async function toolLoop(o: AgentOptions, call: ChatClient['create'], base: ChatMessage[]): Promise<AgentReply> {
  const tools = toolDefinitions(o.scope);
  const messages = [...base];
  const used: string[] = [];
  const maxRounds = o.maxRounds ?? 3;
  for (let round = 0; round <= maxRounds; round++) {
    const final = round === maxRounds;
    let resp;
    try {
      resp = await call({model: o.model, messages, tools, tool_choice: final ? 'none' : round === 0 ? 'required' : 'auto'});
    } catch (e) {
      if (round === 0 && /tool|function/i.test(String((e as Error)?.message))) throw new ToolsUnsupported();
      throw e;
    }
    const msg = resp.choices[0]?.message;
    if (!msg) throw new Error('empty response');
    const calls = (msg.tool_calls ?? []).slice(0, 3);
    if (calls.length && !final) {
      messages.push({role: 'assistant', content: msg.content ?? null, tool_calls: calls});
      for (const c of calls) {
        const v = validateCall(o.scope, c.function.name, c.function.arguments);
        let result: unknown;
        if (!v.ok) result = {error: v.error};
        else {
          used.push(c.function.name);
          try {
            result = await o.execute(c.function.name, v.args);
          } catch (e) {
            result = {error: (e as Error).message || 'Ошибка получения данных'};
          }
        }
        messages.push({role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 8000)});
      }
      continue;
    }
    // A text answer before any successful tool call is not allowed: the
    // provider ignored tool_choice, so use the JSON path instead.
    if (!used.length) throw new ToolsUnsupported();
    const text = (msg.content ?? '').trim();
    if (!text) throw new Error('empty answer');
    return {text, mode: 'tools', tools: used};
  }
  throw new Error('tool loop exhausted');
}

async function jsonIntent(o: AgentOptions, call: ChatClient['create'], base: ChatMessage[]): Promise<AgentReply> {
  const catalogue = toolDefinitions(o.scope)
    .map(t => `- ${t.function.name}: ${t.function.description} Аргументы (JSON Schema): ${JSON.stringify(t.function.parameters)}`)
    .join('\n');
  const ask: ChatMessage[] = [
    {
      role: 'system',
      content: `${o.system}\n\nСначала выбери ОДИН инструмент. Ответь строго JSON без текста вокруг: {"tool": "<имя>" | null, "args": {...}, "clarify": "<вопрос клиенту>" | null}. Если данных для выбора не хватает — tool = null и уточняющий вопрос в clarify.\nИнструменты:\n${catalogue}`,
    },
    ...base.slice(1),
  ];
  const first = await call({model: o.model, messages: ask, response_format: {type: 'json_object'}});
  let parsed: {tool?: string | null; args?: unknown; clarify?: string | null};
  try {
    parsed = JSON.parse(first.choices[0]?.message.content ?? '');
  } catch {
    return o.fallback('bad-json');
  }
  if (!parsed.tool) {
    if (parsed.clarify) return {text: String(parsed.clarify).slice(0, 500), mode: 'json', tools: []};
    return o.fallback('no-intent');
  }
  const v = validateCall(o.scope, parsed.tool, parsed.args ?? {});
  if (!v.ok) return o.fallback('invalid-intent');
  const data = await o.execute(parsed.tool, v.args);
  const answer = await call({
    model: o.model,
    messages: [
      ...base,
      {role: 'system', content: `Данные инструмента ${parsed.tool} (используй только их, ничего не придумывай):\n${JSON.stringify(data).slice(0, 8000)}`},
    ],
  });
  const text = (answer.choices[0]?.message.content ?? '').trim();
  if (!text) return o.fallback('empty-answer');
  return {text, mode: 'json', tools: [parsed.tool]};
}
