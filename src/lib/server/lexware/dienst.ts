import { systemAbfrage, type Kontext } from '../db';
import type { LexwareClient } from './client';
import { holeClient } from './konfig';
import { arbeiteAb, type HandlerTabelle } from './warteschlange';
import { kontaktAktualisieren, kontaktAnlegen, kontakteAbgleichen } from './kontakte';
import { abosEinrichten, belegeAbgleichen, naechtlicherAbgleich } from './abgleich';
import { verarbeiteEreignisse } from './ereignis';
import { abAnlegen, abVersand, angebotFestschreiben, angebotVersand } from './angebote';
import { rechnungAnlegen, rechnungHolen, zahlungHolen } from './rechnungen';
import { mahnungAnlegen, mahnungVersand, pruefeMahnungenGedrosselt } from './mahnungen';

/**
 * Hintergrund-Dienst für Lexware (jede Minute, wie Erinnerungen; aus mit CRM_LEXWARE_DIENST=aus, in Tests nie):
 * je verbundenem Betrieb Rückmeldungen verarbeiten, ab 02:00 einmal täglich den Abgleich einstellen, dann die
 * Warteschlange abarbeiten. Läuft dank Datenbank-Sperre (pg_try_advisory_xact_lock) nie doppelt, auch nicht bei
 * mehreren App-Prozessen.
 */

export const HANDLER: HandlerTabelle = {
	kontakt_anlegen: kontaktAnlegen,
	kontakt_aktualisieren: kontaktAktualisieren,
	kontakte_abgleichen: kontakteAbgleichen,
	belege_abgleichen: belegeAbgleichen,
	abos_einrichten: abosEinrichten,
	angebot_festschreiben: angebotFestschreiben,
	angebot_versand: angebotVersand,
	ab_anlegen: abAnlegen,
	ab_versand: abVersand,
	rechnung_anlegen: rechnungAnlegen,
	rechnung_holen: rechnungHolen,
	zahlung_holen: zahlungHolen,
	mahnung_anlegen: mahnungAnlegen,
	mahnung_versand: mahnungVersand
};

/** Ein Durchlauf für einen Betrieb (auch „Jetzt ausführen“ auf der Einstellungsseite). */
export async function laufFuerBetrieb(k: Kontext, o: { client?: LexwareClient; jetzt?: Date; max?: number } = {}) {
	const ereignisse = await verarbeiteEreignisse(k);
	const nacht = await naechtlicherAbgleich(k, o.jetzt ?? new Date());
	// Mahnstufen (Phase 3): höchstens stündlich, Basis gespiegelte Fälligkeit
	if (!o.client) await pruefeMahnungenGedrosselt(k);
	const client = o.client ?? (await holeClient(k));
	const warteschlange = await arbeiteAb(k, client, HANDLER, { max: o.max ?? 50 });
	return { ereignisse, nacht, ...warteschlange };
}

const SPERRE = 7_315_002; // beliebige, feste Zahl für pg_try_advisory_xact_lock

export async function lexwareLauf(): Promise<number> {
	return systemAbfrage(async (sql) => {
		const [s] = await sql`select pg_try_advisory_xact_lock(${SPERRE}) as ok`;
		if (!s.ok) return 0;
		const kontexte = await sql`select betrieb_id, benutzer_id from app.lexware_dienst_kontexte()`;
		let n = 0;
		for (const x of kontexte) {
			if (!x.benutzer_id) continue;
			try {
				await laufFuerBetrieb({ betriebId: x.betrieb_id, benutzerId: x.benutzer_id });
				n++;
			} catch (e) {
				console.error('Lexware-Dienst:', (e as Error).message);
			}
		}
		return n;
	});
}

let dienst: ReturnType<typeof setInterval> | null = null;
let laeuft = false;
export function starteLexwareDienst(intervallMs = 60_000): void {
	if (dienst) return;
	dienst = setInterval(async () => {
		if (laeuft) return;
		laeuft = true;
		try {
			await lexwareLauf();
		} catch (e) {
			console.error('Lexware-Dienst:', e);
		} finally {
			laeuft = false;
		}
	}, intervallMs);
	dienst.unref?.();
}
export function stoppeLexwareDienst(): void {
	if (dienst) clearInterval(dienst);
	dienst = null;
}
