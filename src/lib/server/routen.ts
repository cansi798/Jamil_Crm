import { kmAusLuftlinie, STANDARD_UMWEG, type Punkt } from '../zeiterfassung';

/**
 * Fahr-Kilometer zwischen zwei Punkten (Zeiterfassung „Abfahrt / Angekommen“).
 *
 * 1. Ist `CRM_ROUTEN_URL` gesetzt (OSRM-Server, z. B. ein eigener `osrm-backend` oder https://router.project-osrm.org),
 *    wird die Straßenstrecke abgefragt: `<url>/route/v1/driving/<lng>,<lat>;<lng>,<lat>?overview=false`, Zeitlimit 5 s.
 *    Datenschutz: Dabei gehen nur die zwei Koordinaten an den Server, keine Namen oder Adressen. Ein eigener
 *    OSRM-Server ist zu empfehlen; der öffentliche Demo-Server ist nur für Tests gedacht.
 * 2. Sonst (oder wenn die Abfrage scheitert): Luftlinie × Umwegfaktor (`CRM_ROUTEN_FAKTOR`, Standard 1,3).
 *
 * Ergebnis auf 0,1 km gerundet mit Quelle („route“ bzw. „luftlinie“) – der Monteur kann den Wert immer überschreiben.
 */

export type KmErgebnis = { km: number; quelle: 'route' | 'luftlinie' };

export function umwegFaktor(env: Record<string, string | undefined> = process.env): number {
	const f = Number((env.CRM_ROUTEN_FAKTOR ?? '').replace(',', '.'));
	return Number.isFinite(f) && f >= 1 && f <= 3 ? f : STANDARD_UMWEG;
}

export async function fahrKm(a: Punkt, b: Punkt, env: Record<string, string | undefined> = process.env): Promise<KmErgebnis> {
	const url = (env.CRM_ROUTEN_URL ?? '').trim().replace(/\/+$/, '');
	if (/^https?:\/\//.test(url)) {
		try {
			const r = await fetch(`${url}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(5000)
			});
			if (r.ok) {
				const j = (await r.json()) as { code?: string; routes?: { distance?: number }[] };
				const m = j.routes?.[0]?.distance;
				if (j.code === 'Ok' && typeof m === 'number' && Number.isFinite(m) && m >= 0) {
					return { km: Math.round(m / 100) / 10, quelle: 'route' };
				}
			} else await r.body?.cancel().catch(() => {});
			console.warn(`Routen: Server antwortet mit ${r.status} – nehme Luftlinie`);
		} catch (e) {
			console.warn(`Routen: Abfrage fehlgeschlagen (${(e as Error)?.name ?? 'Fehler'}) – nehme Luftlinie`);
		}
	}
	return { km: kmAusLuftlinie(a, b, umwegFaktor(env)), quelle: 'luftlinie' };
}
