import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleOrder} from '../_shared/handlers.ts';

const ctx = ctxFromEnv(name => Deno.env.get(name));
Deno.serve(req => handleOrder(req, ctx));
