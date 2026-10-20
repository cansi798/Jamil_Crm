import { erzeugeBegrenzung } from '../auth/ratelimit';

/** „Mit Nextcloud anmelden“: höchstens 20 Starts bzw. Rückrufe je IP-Adresse in 15 Minuten. */
export const ssoBegrenzung = erzeugeBegrenzung({ max: 20, fensterMs: 15 * 60 * 1000 });
