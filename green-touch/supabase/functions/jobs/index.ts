import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleJobs} from '../_shared/handlers.ts';

const ctx = ctxFromEnv(name => Deno.env.get(name));
Deno.serve(req => handleJobs(req, ctx));
