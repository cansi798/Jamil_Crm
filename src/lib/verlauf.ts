import { STATUS_NAMEN } from './auftrag-status';

/**
 * Aufbereitung von Einträgen des Änderungsprotokolls für die Anzeige („Verlauf“). Reine Funktionen ohne Serverbezug.
 * Der Eintrag entspricht `ProtokollEintrag` aus `$lib/server/protokoll`.
 */

export type VerlaufEintrag = {
	id: string;
	zeit: string;
	aktion: 'angelegt' | 'geaendert' | 'geloescht';
	benutzerId: string | null;
	benutzerName: string | null;
	quelle: string;
	vorher: Record<string, unknown> | null;
	nachher: Record<string, unknown> | null;
};

export type VerlaufAenderung = { feld: string; alt: string; neu: string };
export type VerlaufZeile = {
	id: string;
	zeit: string;
	wer: string;
	titel: string;
	aenderungen: VerlaufAenderung[];
};

const FELDNAMEN: Record<string, string> = {
	art: 'Art',
	firma: 'Firma',
	anrede: 'Anrede',
	vorname: 'Vorname',
	nachname: 'Nachname',
	email: 'E-Mail',
	telefon: 'Telefon',
	strasse: 'Straße',
	plz: 'PLZ',
	ort: 'Ort',
	notiz: 'Notiz',
	bezeichnung: 'Bezeichnung',
	titel: 'Titel',
	status: 'Status',
	beschreibung: 'Beschreibung',
	geplant_ab: 'Geplant ab'
};

const WERTNAMEN: Record<string, Record<string, string>> = {
	art: { privat: 'Privatkunde', firma: 'Firmenkunde' },
	status: STATUS_NAMEN
};

const TITEL = { angelegt: 'Angelegt', geaendert: 'Geändert', geloescht: 'Gelöscht' } as const;

const zeitFormat = new Intl.DateTimeFormat('de-DE', {
	timeZone: 'Europe/Berlin',
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

function wert(feld: string, v: unknown): string {
	if (v === null || v === undefined || v === '') return '–';
	const text = String(v);
	return WERTNAMEN[feld]?.[text] ?? text;
}

/** Eine Zeile des Verlaufs: wann, wer, was – bei Änderungen mit den geänderten Feldern (alt → neu). */
export function verlaufZeile(e: VerlaufEintrag): VerlaufZeile {
	const aenderungen: VerlaufAenderung[] = [];
	if (e.aktion === 'geaendert' && e.vorher && e.nachher) {
		for (const feld of Object.keys(FELDNAMEN)) {
			const alt = e.vorher[feld] ?? null;
			const neu = e.nachher[feld] ?? null;
			if (JSON.stringify(alt) !== JSON.stringify(neu)) {
				aenderungen.push({ feld: FELDNAMEN[feld], alt: wert(feld, alt), neu: wert(feld, neu) });
			}
		}
	}
	return {
		id: e.id,
		zeit: zeitFormat.format(new Date(e.zeit)),
		// Aktionen per Sprachsteuerung sind im Verlauf erkennbar (Pflichtenheft: „auch bei Aktionen per Sprache“)
		wer: `${e.benutzerName ?? 'System'}${e.quelle === 'sprache' ? ' (per Sprache)' : ''}`,
		titel: TITEL[e.aktion],
		aenderungen
	};
}
