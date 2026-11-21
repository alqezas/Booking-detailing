import {ctxFromEnv} from '../_shared/ctx.ts';
import {handleJobs} from '../_shared/handlers.ts';
import {smtpMailerFromEnv} from '../_shared/smtp.ts';

const env = (name: string) => Deno.env.get(name);
const ctx = {...ctxFromEnv(env), mailer: smtpMailerFromEnv(env)};
Deno.serve(req => handleJobs(req, ctx));
