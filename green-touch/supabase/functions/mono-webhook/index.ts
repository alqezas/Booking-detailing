import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleMonoWebhook} from '../_shared/handlers.ts';

const ctx = ctxFromEnv(name => Deno.env.get(name));
Deno.serve(req => handleMonoWebhook(req, ctx));
