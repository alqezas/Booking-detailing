import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleTelegram} from '../_shared/telegram.ts';

const ctx = ctxFromEnv(name => Deno.env.get(name));
Deno.serve(req => handleTelegram(req, ctx));
