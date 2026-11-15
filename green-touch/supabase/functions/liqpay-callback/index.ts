import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleLiqPayCallback} from '../_shared/handlers.ts';

const ctx = ctxFromEnv(name => Deno.env.get(name));
Deno.serve(req => handleLiqPayCallback(req, ctx));
