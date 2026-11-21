/**
 * Starts the controlled test adapters for local runs and CI:
 *   mono → http://127.0.0.1:55480   Nova Poshta → http://127.0.0.1:55481/v2.0/json/
 * These are NOT the real services; see ACCEPTANCE.md for what was checked live.
 */
import {startFakeMono} from './mono.ts';
import {startFakeNp} from './np.ts';

const mono = await startFakeMono(Number(process.env.FAKE_MONO_PORT ?? 55480), process.env.FAKE_MONO_TOKEN ?? 'test-mono-token');
const np = await startFakeNp(Number(process.env.FAKE_NP_PORT ?? 55481));
console.log(`fake mono: ${mono.url}\nfake nova poshta: ${np.url}`);
