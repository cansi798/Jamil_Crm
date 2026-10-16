import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfProtokollLesen, liesProtokoll, PROTOKOLL_MODULE, pruefeSuche } from '$lib/server/protokoll';
import { pruefeModul } from '$lib/server/tarif';
import { holeAuftrag, sichtVon } from '$lib/server/auftraege';

/**
 * Änderungsverlauf eines Datensatzes: `GET /api/protokoll?tabelle=rollen&datensatz=<uuid>[&vor=<id>]`.
 * Antwort `{ eintraege, naechsteVor }` – 50 Einträge, neueste zuerst; `naechsteVor` für die nächste Seite (sonst null).
 * Lesen darf, wer das Leserecht der Tabelle hat (siehe `PROTOKOLL_TABELLEN`) – bei Verwaltungstabellen auch mit
 * `einstellungen`. Tabellen eines Tarif-Moduls (kunden, objekte) verlangen immer ihr eigenes Recht (R19), und der
 * Betrieb muss das Modul haben (402, siehe `PROTOKOLL_MODULE`). Aufträge: Wer nur seine eigenen Aufträge sehen darf
 * (`auftraege.lesen` ohne `auftraege.alle_lesen`), bekommt den Verlauf eines fremden Auftrags nicht (404).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		if (!locals.nutzer) throw new ApiFehler(401, 'Nicht angemeldet');
		const k = betriebKontext(locals);
		const suche = pruefeSuche(url.searchParams);
		if (!darfProtokollLesen(locals.nutzer, suche.tabelle)) throw new ApiFehler(403, 'Keine Berechtigung');
		const modul = PROTOKOLL_MODULE[suche.tabelle];
		if (modul) await pruefeModul(locals, modul);
		const sicht = sichtVon(locals.nutzer);
		if (suche.tabelle === 'auftraege' && !sicht.alle) await holeAuftrag(k, sicht, suche.datensatz);
		return json(await liesProtokoll(k, suche));
	} catch (e) {
		return alsAntwort(e);
	}
};
