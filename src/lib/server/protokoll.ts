import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { hatRecht, type Recht } from './rechte';
import type { Modul } from '../tarife';

/**
 * Lesezugriff auf das Änderungsprotokoll (`app.aenderungen`, geschrieben vom Trigger `app.protokolliere()`).
 *
 * Positivliste der abfragbaren Tabellen mit dem Recht, das sie lesen darf. Bei Verwaltungstabellen genügt auch
 * `einstellungen`; Tabellen eines Tarif-Moduls (`PROTOKOLL_MODULE`, z. B. Kundendaten) verlangen immer ihr eigenes
 * Recht (Ruling R19, Datenschutz). Neue protokollierte Tabellen werden hier eingetragen.
 */
export const PROTOKOLL_TABELLEN = {
	rollen: 'einstellungen',
	benutzer: 'benutzer.verwalten',
	einladungen: 'benutzer.verwalten',
	kunden: 'kunden.lesen',
	objekte: 'kunden.lesen'
} as const satisfies Record<string, Recht>;

export type ProtokollTabelle = keyof typeof PROTOKOLL_TABELLEN;

/**
 * Tabellen, die zu einem Tarif-Modul gehören: Der Verlauf ist nur lesbar, wenn der Betrieb das Modul hat
 * (`pruefeModul`, 402) – zusätzlich zum Leserecht, damit er nicht am Modul vorbei Daten verrät.
 */
export const PROTOKOLL_MODULE: Partial<Record<ProtokollTabelle, Modul>> = {
	kunden: 'kunden',
	objekte: 'kunden'
};

export const SEITENGROESSE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// bigserial: positive ganze Zahl, höchstens 2^63-1 (19 Stellen, daher zusätzlich gegen die Obergrenze prüfen)
const LAUFNUMMER = /^[1-9][0-9]{0,18}$/;
const LAUFNUMMER_MAX = 9223372036854775807n;

export type ProtokollEintrag = {
	id: string;
	zeit: string;
	aktion: 'angelegt' | 'geaendert' | 'geloescht';
	benutzerId: string | null;
	benutzerName: string | null;
	quelle: string;
	vorher: Record<string, unknown> | null;
	nachher: Record<string, unknown> | null;
};

export type ProtokollSeite = { eintraege: ProtokollEintrag[]; naechsteVor: string | null };

export type ProtokollSuche = { tabelle: ProtokollTabelle; datensatz: string; vor: string | null };

/** Prüft die Abfrageparameter (400 bei Fehlern); `tabelle` nur aus der Positivliste, `datensatz` eine UUID. */
export function pruefeSuche(params: URLSearchParams): ProtokollSuche {
	const tabelle = params.get('tabelle');
	if (tabelle === null || !Object.hasOwn(PROTOKOLL_TABELLEN, tabelle)) {
		throw new ApiFehler(400, 'Unbekannte Tabelle.');
	}
	const datensatz = params.get('datensatz');
	if (datensatz === null || !UUID.test(datensatz)) {
		throw new ApiFehler(400, 'Ungültiger Datensatz.');
	}
	const vor = params.get('vor');
	if (vor !== null && (!LAUFNUMMER.test(vor) || BigInt(vor) > LAUFNUMMER_MAX)) {
		throw new ApiFehler(400, 'Ungültige Seitenangabe.');
	}
	return { tabelle: tabelle as ProtokollTabelle, datensatz, vor };
}

/**
 * Darf dieser Nutzer das Protokoll der Tabelle lesen? Das Leserecht der Tabelle genügt immer. `einstellungen` genügt
 * nur bei Verwaltungstabellen – nicht bei Tabellen eines Moduls (Kundendaten): Wer Kunden nicht sehen darf, soll
 * ihre Daten auch nicht über den Verlauf lesen (Ruling R19).
 */
export function darfProtokollLesen(nutzer: Nutzer, tabelle: ProtokollTabelle): boolean {
	if (hatRecht(nutzer, PROTOKOLL_TABELLEN[tabelle])) return true;
	return !Object.hasOwn(PROTOKOLL_MODULE, tabelle) && hatRecht(nutzer, 'einstellungen');
}

/**
 * Verlauf eines Datensatzes, neueste zuerst, höchstens `SEITENGROESSE` Einträge. Mit `vor` (der `naechsteVor`-Wert
 * der vorigen Seite) geht es bei den älteren Einträgen weiter. Mandantentrennung doppelt: RLS und ausdrücklicher Filter.
 */
export function liesProtokoll(k: Kontext, suche: ProtokollSuche): Promise<ProtokollSeite> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select a.id::text as id, a.zeit, a.aktion, a.benutzer_id, b.name as benutzer_name, a.quelle,
				a.vorher, a.nachher
			from app.aenderungen a
			left join app.benutzer b on b.id = a.benutzer_id
			where a.betrieb_id = ${k.betriebId}
				and a.tabelle = ${suche.tabelle}
				and a.datensatz_id = ${suche.datensatz}
				${suche.vor === null ? tx`` : tx`and a.id < ${suche.vor}::bigint`}
			order by a.id desc
			limit ${SEITENGROESSE + 1}`;
		const seite = z.slice(0, SEITENGROESSE);
		return {
			eintraege: seite.map((e) => ({
				id: e.id,
				zeit: new Date(e.zeit).toISOString(),
				aktion: e.aktion,
				benutzerId: e.benutzer_id,
				benutzerName: e.benutzer_name,
				quelle: e.quelle,
				vorher: e.vorher,
				nachher: e.nachher
			})),
			naechsteVor: z.length > SEITENGROESSE ? seite[seite.length - 1].id : null
		};
	});
}
