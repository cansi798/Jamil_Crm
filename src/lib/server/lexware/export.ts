import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext } from '../db';
import { berlinTag } from '../../zeit';
import { ladePdfDaten, type AngebotZugriff } from '../angebote';
import { belegEingabe } from './angebote';
import { ladeRechnung, rechnungsBeleg } from './rechnungen';
import {
	angebotZuLexwareQuotation,
	kontaktZuLexware,
	rechnungZuLexwareInvoice,
	type KundeFuerLexware,
	type LexwareInvoice,
	type LexwarePaket,
	type LexwareQuotation
} from './format';

/**
 * „Lexware-JSON herunterladen“: das Paket, das eine spätere Anbindung (z. B. Supabase Edge Function) an Lexware
 * schicken würde – OHNE Verbindung, ohne Schlüssel, ohne Schreibzugriff. Rechte prüft der Endpunkt
 * (Angebote: `angeboteZugriff` inkl. preise.sehen; Rechnungen: `rechnungenZugriff` + preise).
 */

async function kontaktFuer(k: Kontext, kundeId: string | null) {
	if (!kundeId) return { kontakt: null, hinweis: 'Ohne Kunde: Einmal-Adresse (Sammelkunde in Lexware).' };
	const [kd] = await mitBetrieb(k, (tx) => tx`
		select id, art, firma, anrede, vorname, nachname, email::text, telefon, strasse, plz, ort, land, ust_id as "ustId", steuernummer,
			leitweg_id, lexware_id
		from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`);
	if (!kd) return { kontakt: null, hinweis: 'Kunde nicht mehr vorhanden.' };
	if (kd.lexware_id) return { kontakt: null, hinweis: `Kunde ist schon mit Lexware verknüpft (contactId ${kd.lexware_id}).` };
	const daten: KundeFuerLexware = { ...(kd as unknown as KundeFuerLexware), leitwegId: kd.leitweg_id ?? null };
	return { kontakt: kontaktZuLexware(daten), hinweis: 'Kunde ist noch nicht in Lexware: zuerst „kontakt“ senden, die Antwort-ID als beleg.body.address.contactId einsetzen.' };
}

export async function angebotLexwarePaket(k: Kontext, id: string, zg: AngebotZugriff): Promise<LexwarePaket<LexwareQuotation>> {
	const daten = await ladePdfDaten(k, id, zg); // Sicht/Recht wie beim PDF
	const e = await belegEingabe(k, daten.angebot.id);
	const { kontakt, hinweis } = await kontaktFuer(k, e.kundeId);
	return {
		format: 'lexware-office-v1',
		quelle: { art: 'angebot', id: daten.angebot.id, nummer: daten.angebot.nummer ?? null },
		kontakt,
		beleg: angebotZuLexwareQuotation(e),
		hinweise: [hinweis, 'Nummer vergibt Lexware beim Anlegen (Nummernkreis in Lexware).']
	};
}

export async function rechnungLexwarePaket(k: Kontext, id: string): Promise<LexwarePaket<LexwareInvoice>> {
	const r = await ladeRechnung(k, id);
	if (!r) throw new ApiFehler(404, 'Rechnung nicht gefunden.');
	if (!r.angebot_id) throw new ApiFehler(409, 'Die Rechnung hat kein Angebot mehr – das Lexware-Format lässt sich nicht bilden.');
	const heute = berlinTag(new Date());
	const { e, eingabe } = await rechnungsBeleg(k, r, heute);
	const { kontakt, hinweis } = await kontaktFuer(k, e.kundeId);
	return {
		format: 'lexware-office-v1',
		quelle: { art: 'rechnung', id: r.id, nummer: null },
		kontakt,
		beleg: rechnungZuLexwareInvoice(eingabe, { vorgaengerLexwareId: r.vorgaenger_id ?? null, festschreiben: r.festschreiben === true }),
		hinweise: [
			hinweis,
			r.lexware_id ? `Diese Rechnung ist schon in Lexware angelegt (${r.lexware_id}) – Paket nur zur Ansicht.` : 'Ohne finalize legt Lexware einen Entwurf an; die Nummer wird trotzdem verbraucht.',
			...(r.art === 'abschlag'
				? ['Abschlag: Lexware legt Abschlagsrechnungen nicht per Schnittstelle an (nur lesbar) – Werte als BRUTTO (taxType gross, grossAmount) für „In Lexware fertigstellen“; so stimmt der Betrag auf den Cent.']
				: [])
		]
	};
}
