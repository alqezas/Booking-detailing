/**
 * Starts the controlled test adapters for local runs and CI:
 *   LiqPay → http://127.0.0.1:55480   Nova Poshta → http://127.0.0.1:55481/v2.0/json/
 * These are NOT the real services; see ACCEPTANCE.md for what was checked live.
 */
import {startFakeLiqPay} from './liqpay.ts';
import {startFakeNp} from './np.ts';

const liqpay = await startFakeLiqPay(Number(process.env.FAKE_LIQPAY_PORT ?? 55480));
const np = await startFakeNp(Number(process.env.FAKE_NP_PORT ?? 55481));
console.log(`fake liqpay: ${liqpay.url}\nfake nova poshta: ${np.url}`);
