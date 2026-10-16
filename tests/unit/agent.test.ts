/**
 * The agent loop with a scripted chat client (a test double for the OpenAI
 * SDK — no network, no real model). It verifies the guarantees we own:
 * tool first, scope enforcement, bounded rounds, JSON fallback, budget stop.
 */
import {describe, expect, it, vi} from 'vitest';
import {runAgent, type ChatClient, type ChatMessage, type ToolCall} from '../../supabase/functions/_shared/agent.ts';
import {toolDefinitions, validateCall} from '../../supabase/functions/_shared/tools.ts';

type Resp = Awaited<ReturnType<ChatClient['create']>>;
const text = (content: string): Resp => ({choices: [{message: {content}}], usage: {total_tokens: 50}});
const tools = (...calls: [string, unknown][]): Resp => ({
  choices: [{message: {content: null, tool_calls: calls.map(([name, args], i): ToolCall => ({id: `c${i}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}))}}],
  usage: {total_tokens: 80},
});

function scripted(...responses: (Resp | Error)[]) {
  const calls: Parameters<ChatClient['create']>[0][] = [];
  const chat: ChatClient = {
    create: async p => {
      calls.push(structuredClone(p));
      const r = responses.shift();
      if (!r) throw new Error('no more responses');
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return {chat, calls};
}

const SERVICE = '11111111-1111-4111-8111-111111111111';
const base = {
  system: 'sys',
  history: [],
  model: 'test-model',
  toolMode: 'auto' as const,
  fallback: async (reason: string) => ({text: `fallback:${reason}`, mode: 'fallback' as const, tools: []}),
};

describe('tool scopes', () => {
  it('client and owner tools are disjoint and read-only', () => {
    const client = toolDefinitions('client').map(t => t.function.name);
    const owner = toolDefinitions('owner').map(t => t.function.name);
    expect(client).toEqual(['get_studio_info', 'list_services', 'find_free_slots']);
    expect(owner).toEqual(['get_bookings', 'get_stats']);
    expect(client.filter(n => owner.includes(n))).toEqual([]);
    for (const n of [...client, ...owner]) expect(n).not.toMatch(/create|update|delete|cancel|pay|sql/);
  });

  it('no tool accepts a tenant id or SQL', () => {
    for (const scope of ['client', 'owner'] as const) {
      for (const t of toolDefinitions(scope)) {
        const props = Object.keys((t.function.parameters as {properties?: object}).properties ?? {});
        expect(props.some(p => /tenant|sql|query/.test(p))).toBe(false);
      }
    }
    expect(validateCall('client', 'find_free_slots', {service_id: SERVICE, tenant_id: 'x'}).ok).toBe(false);
  });

  it('rejects an owner tool requested in the client scope', () => {
    expect(validateCall('client', 'get_bookings', {period: 'day', anchor_date: '2026-10-16'})).toEqual({ok: false, error: 'Инструмент «get_bookings» недоступен'});
  });
});

describe('tool loop', () => {
  it('forces a tool call first, executes it, then answers from the result', async () => {
    const {chat, calls} = scripted(tools(['find_free_slots', {service_id: SERVICE}]), text('Завтра в 10:00 свободно.'));
    const execute = vi.fn(async () => ({slots: [{label: 'завтра в 10:00'}]}));
    const r = await runAgent({...base, scope: 'client', user: 'когда окно?', chat, execute});
    expect(calls[0]!.tool_choice).toBe('required');
    expect(execute).toHaveBeenCalledWith('find_free_slots', {service_id: SERVICE});
    const toolMsg = calls[1]!.messages.find((m: ChatMessage) => m.role === 'tool');
    expect(toolMsg && 'content' in toolMsg ? toolMsg.content : '').toContain('завтра в 10:00');
    expect(r).toEqual({text: 'Завтра в 10:00 свободно.', mode: 'tools', tools: ['find_free_slots']});
  });

  it('does not run out-of-scope tools; the model sees an error instead', async () => {
    const {chat, calls} = scripted(tools(['get_bookings', {period: 'day', anchor_date: '2026-10-16'}]), tools(['list_services', {}]), text('Цены такие-то'));
    const execute = vi.fn(async () => [{name: 'Мойка'}]);
    const r = await runAgent({...base, scope: 'client', user: 'покажи записи', chat, execute});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('list_services', {});
    expect(JSON.stringify(calls[1]!.messages)).toContain('недоступен');
    expect(r.tools).toEqual(['list_services']);
  });

  it('stops after the round limit and forces a final answer', async () => {
    const loop = Array.from({length: 3}, () => tools(['list_services', {}]));
    const {chat, calls} = scripted(...loop, text('Итог'));
    const r = await runAgent({...base, scope: 'client', user: 'цены', chat, execute: async () => [], maxRounds: 3});
    expect(calls).toHaveLength(4);
    expect(calls[3]!.tool_choice).toBe('none');
    expect(r.text).toBe('Итог');
  });

  it('switches to the JSON intent path when the provider ignores tools', async () => {
    const {chat, calls} = scripted(
      text('Я думаю, завтра свободно'), // ignored tool_choice → not trusted
      text(JSON.stringify({tool: 'find_free_slots', args: {service_id: SERVICE}, clarify: null})),
      text('Свободно завтра в 10:00.'),
    );
    const execute = vi.fn(async () => ({slots: ['10:00']}));
    const r = await runAgent({...base, scope: 'client', user: 'когда?', chat, execute});
    expect(r.mode).toBe('json');
    expect(execute).toHaveBeenCalledOnce();
    expect(calls[1]!.response_format).toEqual({type: 'json_object'});
    expect(JSON.stringify(calls[2]!.messages)).toContain('10:00');
  });

  it('json mode can ask a clarifying question without inventing data', async () => {
    const {chat} = scripted(text(JSON.stringify({tool: null, args: {}, clarify: 'На какую услугу?'})));
    const execute = vi.fn();
    const r = await runAgent({...base, scope: 'client', toolMode: 'json', user: 'когда?', chat, execute});
    expect(r).toEqual({text: 'На какую услугу?', mode: 'json', tools: []});
    expect(execute).not.toHaveBeenCalled();
  });

  it('falls back to the router on model errors, invalid JSON and no model', async () => {
    expect((await runAgent({...base, scope: 'client', user: 'x', chat: scripted(new Error('500')).chat, execute: vi.fn()})).text).toBe('fallback:model-error');
    expect((await runAgent({...base, scope: 'client', toolMode: 'json', user: 'x', chat: scripted(text('not json')).chat, execute: vi.fn()})).text).toBe('fallback:bad-json');
    expect((await runAgent({...base, scope: 'client', user: 'x', chat: null, execute: vi.fn()})).text).toBe('fallback:no-model');
  });

  it('stops before calling the model when the budget is exhausted', async () => {
    const {chat, calls} = scripted(text('never'));
    const r = await runAgent({...base, scope: 'owner', user: 'деньги', chat, execute: vi.fn(), reserve: async () => false});
    expect(calls).toHaveLength(0);
    expect(r.text).toBe('fallback:budget');
  });

  it('settles the real token usage after each call', async () => {
    const settle = vi.fn(async () => undefined);
    const {chat} = scripted(tools(['get_stats', {period: 'week', anchor_date: '2026-10-16'}]), text('Неделя: 5 машин'));
    await runAgent({...base, scope: 'owner', user: 'сколько машин', chat, execute: async () => ({arrivals: 5}), reserve: async () => true, settle});
    expect(settle).toHaveBeenCalledTimes(2);
    expect((settle.mock.calls[0] as unknown as number[])[1]).toBe(80);
  });
});
