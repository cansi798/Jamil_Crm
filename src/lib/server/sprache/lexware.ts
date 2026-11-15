import type { Kontext } from '../db';
import { anzeigeName, listeKunden } from '../kunden';
import type { KiAktion } from './aktionen';
import type { Karte } from './aufloesen';
import { lexwareStatus, statusSatz } from '../lexware/status';
import { starteAbgleich } from '../lexware/abgleich';
import { kundeLexwareStand } from '../lexware/kontakte';
import { mailStatus } from '../mail/konfig';

/**
 * Sprachaktionen zu Lexware und Mailversand (Plan Lexware Phase 1; STANDING RULE: jede neue Funktion bekommt eine
 * Sprachaktion). Rechte prüft `rechte.ts` vorher. Alle ohne Bestätigung: Fragen bzw. einen Abgleich einstellen.
 */
type LexAktion = Extract<KiAktion, { aktion: 'abfrage_lexware' | 'lexware_abgleich_starten' | 'abfrage_kunde_lexware' | 'abfrage_mailversand' }>;

function karte(aktion: LexAktion['aktion'], titel: string, vorlesen: string, eintraege: { titel: string; link: string }[] = [], fehler: string | null = null): Karte {
	return {
		aktion,
		titel,
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler,
		aendern: null,
		antwort: { abschnitte: eintraege.length ? [{ titel: 'Öffnen', eintraege: eintraege.map((e) => ({ zeit: '', titel: e.titel, ort: null, link: e.link, ueberfaellig: false })) }] : [], vorlesen }
	};
}

export async function beantworteLexware(k: Kontext, a: LexAktion): Promise<Karte> {
	const einstellungen = { titel: 'Lexware verbinden öffnen', link: '/einstellungen/lexware' };
	if (a.aktion === 'abfrage_lexware') {
		const s = await lexwareStatus(k);
		return karte(a.aktion, 'Lexware', statusSatz(s), [einstellungen]);
	}
	if (a.aktion === 'lexware_abgleich_starten') {
		const s = await lexwareStatus(k);
		if (!s.schluesselGesetzt || s.status === 'schluessel_ungueltig')
			return karte(a.aktion, 'Lexware-Abgleich', statusSatz(s), [einstellungen]);
		const r = await starteAbgleich(k);
		return karte(a.aktion, 'Lexware-Abgleich', r.belege || r.kunden ? 'Der Abgleich mit Lexware läuft im Hintergrund – Kunden und Belege.' : 'Der Abgleich ist schon unterwegs.', [einstellungen]);
	}
	if (a.aktion === 'abfrage_kunde_lexware') {
		const treffer = await listeKunden(k, a.daten.kunde.slice(0, 80));
		if (treffer.length === 0) return karte(a.aktion, 'Kunde in Lexware', `Ich finde keinen Kunden „${a.daten.kunde}“.`, [], `Kein Kunde „${a.daten.kunde}“ gefunden.`);
		if (treffer.length > 1 && treffer.length <= 5) {
			const namen = treffer.map((kd) => [anzeigeName(kd), kd.ort].filter(Boolean).join(', '));
			return karte(a.aktion, 'Kunde in Lexware', `Welchen meinst du: ${namen.join(' oder ')}?`, treffer.map((kd, i) => ({ titel: namen[i], link: `/kunden/${kd.id}#lexware` })));
		}
		if (treffer.length > 5) return karte(a.aktion, 'Kunde in Lexware', `Zu „${a.daten.kunde}“ gibt es ${treffer.length} Kunden – bitte genauer sagen.`);
		const kd = treffer[0];
		const st = await kundeLexwareStand(k, kd.id);
		const name = anzeigeName(kd);
		const satz = st.verknuepft
			? `${name} ist in Lexware${st.aktuell ? ' und auf dem neuesten Stand' : ', aber die letzte Änderung aus dem CRM ist noch nicht übertragen'}.${st.geaendertInLexware ? ' In Lexware wurde der Kontakt zuletzt geändert.' : ''}`
			: st.inArbeit
				? `${name} wird gerade in Lexware angelegt.`
				: `${name} ist noch nicht in Lexware. Du kannst ihn in der Kundenakte mit „In Lexware übertragen“ anlegen.`;
		return karte(a.aktion, 'Kunde in Lexware', `${satz}${st.problem ? ` Problem: ${st.problem}` : ''}`, [{ titel: `${name} öffnen`, link: `/kunden/${kd.id}#lexware` }]);
	}
	const m = await mailStatus(k);
	const satz = [
		m.eingerichtet && m.aktiv && m.erlaubt ? 'Der Mailversand ist eingerichtet und eingeschaltet.' : `Kein automatischer Mailversand: ${m.grund}`,
		m.fehler24h > 0 ? `In den letzten 24 Stunden gab es ${m.fehler24h} Mail${m.fehler24h === 1 ? '' : 's'} mit Fehler${m.letzterFehler ? `, zuletzt: ${m.letzterFehler}` : ''}.` : 'Keine Mailfehler in den letzten 24 Stunden.',
		m.gesendet24h > 0 ? `${m.gesendet24h} gesendet.` : ''
	].filter(Boolean).join(' ');
	return karte(a.aktion, 'E-Mail-Versand', satz, [{ titel: 'E-Mail-Versand öffnen', link: '/einstellungen/mail' }]);
}
