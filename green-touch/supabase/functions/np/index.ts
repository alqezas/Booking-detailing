import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleNp} from '../_shared/handlers.ts';

const ctx = ctxFromEnv(name => Deno.env.get(name));
Deno.serve(req => handleNp(req, ctx));
