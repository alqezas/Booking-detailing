/**
 * A SIMULATED OpenAI-compatible endpoint for exercising the edge functions'
 * tool loop end-to-end without a real model. It is a scripted test double:
 * its "answers" only restate tool results. Never deploy it; never count its
 * output as a real LLM integration.
 *
 *   tsx tests/integration/fake-llm.ts [port] [--no-tools]
 */
import {createServer} from 'node:http';

const port = Number(process.argv[2] ?? 8787);
const noTools = process.argv.includes('--no-tools');
const log: unknown[] = [];

type Msg = {role: string; content?: string | null; tool_calls?: {function: {name: string}}[]; tool_call_id?: string};

function reply(body: {messages: Msg[]; tools?: {function: {name: string}}[]; tool_choice?: string; response_format?: {type: string}}) {
  const msgs = body.messages;
  const user = [...msgs].reverse().find(m => m.role === 'user')?.content ?? '';
  const toolResults = msgs.filter(m => m.role === 'tool');
  const names = (body.tools ?? []).map(t => t.function.name);
  const call = (name: string, args: unknown) => ({
    choices: [{message: {role: 'assistant', content: null, tool_calls: [{id: `call_${toolResults.length}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}}],
    usage: {total_tokens: 120},
  });
  const text = (content: string) => ({choices: [{message: {role: 'assistant', content}}], usage: {total_tokens: 90}});

  if (noTools && body.tools) return {error: {message: 'tools are not supported by this model'}, status: 400};
  if (body.response_format?.type === 'json_object') {
    return text(JSON.stringify(/деньг|получен/i.test(user) ? {tool: 'get_stats', args: {period: 'week', anchor_date: new Date().toISOString().slice(0, 10)}} : {tool: 'list_services', args: {}}));
  }
  if (!body.tools) {
    const data = msgs.find(m => m.role === 'system' && m.content?.startsWith('Данные инструмента'))?.content ?? '';
    return text(`[симулятор, JSON-режим] ${data.slice(0, 160)}`);
  }
  if (names.includes('find_free_slots')) {
    if (!toolResults.length) return call('list_services', {});
    const last = JSON.parse(toolResults.at(-1)!.content ?? '{}');
    if (Array.isArray(last)) {
      const svc = last.find((s: {name: string}) => /керамик|мойк/i.test(s.name)) ?? last[0];
      return call('find_free_slots', {service_id: svc.id, limit: 2});
    }
    return text(`[симулятор] Ближайшее время на «${last.service?.name}»: ${(last.slots ?? []).map((s: {label: string}) => s.label).join(', ') || 'нет'}.`);
  }
  if (names.includes('get_stats')) {
    if (!toolResults.length) return call('get_stats', {period: 'week', anchor_date: new Date().toISOString().slice(0, 10)});
    const s = JSON.parse(toolResults.at(-1)!.content ?? '{}');
    return text(`[симулятор] ${s.period}: заездов ${s.arrivals}, получено ${s.net_received} ₽.`);
  }
  return text('[симулятор] нет инструментов');
}

createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/log') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(log));
      return;
    }
    const body = JSON.parse(raw || '{}');
    log.push({url: req.url, auth: req.headers.authorization ? 'present' : 'missing', tool_choice: body.tool_choice, tools: (body.tools ?? []).map((t: {function: {name: string}}) => t.function.name), messages: body.messages?.length});
    const r = reply(body) as {status?: number};
    res.statusCode = r.status ?? 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(r));
  });
}).listen(port, () => console.log(`fake LLM (SIMULATOR) on :${port}`));
