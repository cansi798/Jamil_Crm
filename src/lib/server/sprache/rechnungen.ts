import type { Kontext } from '../db';
import { anzeigeName, listeKunden } from '../kunden';
import type { KiAktion } from './aktionen';
import type { Karte } from './aufloesen';
import { listeRechnungen, type RechnungZeile } from '../lexware/rechnungen';
import { euro } from '../../geld';
import { tagDeutsch } from '../../zeit';
import { ZAHL_STATUS_NAMEN } from '../../rechnungen';

/**
 * Fragen zu Rechnungen (Lexware Phase 3; STANDING RULE Sprachaktionen): „Welche Rechnungen sind überfällig?“,
 * „Wer schuldet uns noch Geld?“, „Hat Kunde Müller bezahlt?“. Nur lesend, ohne Bestätigung. Rechte (Rechnungen sehen +
 * Preise sehen, Modul lexware) prüft `rechte.ts` vorher.
 */
type RAktion = Extract<KiAktion, { aktion: 'abfrage_offene_rechnungen' | 'abfrage_zahlstatus' }>;

const zeile = (r: RechnungZeile) => ({
	zeit: r.faellig ? tagDeutsch(r.faellig) : '',
	titel: `${r.nummer ?? 'Rechnung'} · ${r.kunde?.name ?? ''} · ${ZAHL_STATUS_NAMEN[r.status]}${r.offenCent !== null ? ` · offen ${euro(r.offenCent)}` : ''}`,
	ort: null,
	link: r.crm ? `/rechnungen/${r.id}` : '/ausgangsbelege/rechnungen',
	ueberfaellig: r.status === 'ueberfaellig'
});

function karte(aktion: RAktion['aktion'], titel: string, vorlesen: string, liste: RechnungZeile[], fehler: string | null = null): Karte {
	return {
		aktion,
		titel,
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler,
		aendern: null,
		antwort: { abschnitte: liste.length ? [{ titel: 'Rechnungen', eintraege: liste.slice(0, 10).map(zeile) }] : [], vorlesen }
	};
}

export async function beantworteRechnungen(k: Kontext, a: RAktion): Promise<Karte> {
	if (a.aktion === 'abfrage_offene_rechnungen') {
		const filter = a.daten.filter ?? 'offen';
		const liste = await listeRechnungen(k, { filter, preise: true });
		const summe = liste.reduce((s, r) => s + (r.offenCent ?? 0), 0);
		const was = filter === 'ueberfaellig' ? 'überfällige' : filter === 'alle' ? '' : 'offene';
		const satz = liste.length === 0
			? `Keine ${was || ''} Rechnungen.`.replace('  ', ' ')
			: `${liste.length} ${was} Rechnung${liste.length === 1 ? '' : 'en'}${summe > 0 ? `, zusammen ${euro(summe)} offen` : ''}: ${liste.slice(0, 3).map((r) => `${r.kunde?.name ?? r.nummer ?? 'Rechnung'} ${r.offenCent !== null ? euro(r.offenCent) : ''}`.trim()).join(', ')}${liste.length > 3 ? ' …' : ''}.`;
		return karte(a.aktion, filter === 'ueberfaellig' ? 'Überfällige Rechnungen' : 'Offene Rechnungen', satz.replace(/\s+/g, ' '), liste);
	}
	const treffer = await listeKunden(k, a.daten.kunde.slice(0, 80));
	if (treffer.length === 0) return karte(a.aktion, 'Zahlungsstand', `Ich finde keinen Kunden „${a.daten.kunde}“.`, [], `Kein Kunde „${a.daten.kunde}“ gefunden.`);
	if (treffer.length > 5) return karte(a.aktion, 'Zahlungsstand', `Zu „${a.daten.kunde}“ gibt es ${treffer.length} Kunden – bitte genauer sagen.`, []);
	if (treffer.length > 1) return karte(a.aktion, 'Zahlungsstand', `Welchen meinst du: ${treffer.map((kd) => [anzeigeName(kd), kd.ort].filter(Boolean).join(', ')).join(' oder ')}?`, []);
	const kd = treffer[0];
	const name = anzeigeName(kd);
	const liste = await listeRechnungen(k, { kundeId: kd.id, preise: true, filter: 'alle' });
	const offen = liste.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt' || r.status === 'ueberfaellig');
	const satz =
		liste.length === 0
			? `Für ${name} gibt es noch keine Rechnung.`
			: offen.length === 0
				? `Ja, ${name} hat alles bezahlt${liste[0].bezahltAm ? ` – zuletzt am ${tagDeutsch(liste[0].bezahltAm)}` : ''}.`
				: `Nein, bei ${name} ${offen.length === 1 ? 'ist eine Rechnung' : `sind ${offen.length} Rechnungen`} offen: ${offen.map((r) => `${r.nummer ?? 'Rechnung'} ${r.offenCent !== null ? euro(r.offenCent) : ''}${r.status === 'ueberfaellig' ? ' (überfällig)' : r.status === 'teilbezahlt' ? ' (teilweise bezahlt)' : ''}`).join(', ')}.`;
	return karte(a.aktion, 'Zahlungsstand', satz, liste);
}
