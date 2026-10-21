import { mitBetrieb, type Kontext } from './db';
import { aktiveMitarbeiter } from './todos';
import { auftragsKennzahlen, angebotsKennzahlen, cockpit } from './kennzahlen';
import { auswertung } from './quellen';
import type { Sicht } from './auftraege';
import { berlinTag, tagesGrenzen, tagPlus } from '../zeit';
import { zeitraum, type Kennzahl } from '../kennzahlen';

/**
 * Bausteine des Start-Cockpits (Jamil msg 2813) – nur für Nutzer mit „Alle Aufträge ansehen“ (Kennzahlen über den
 * ganzen Betrieb). Zahlen kommen aus dem gemeinsamen Kennzahlen-Modul; hier nur Handlungsbedarf und die Auslastung
 * der nächsten zwei Wochen.
 */

export type Handlung = { id: string; titel: string; anzahl: number; href: string; ton: 'rot' | 'orange' | 'blau' | 'grau' };
export type AuslastungZeile = { id: string; name: string; geplant: number; verfuegbar: number; prozent: number };
export type QuellenUmsatz = { name: string; umsatzCent: number; auftraege: number };
export type StartCockpit = {
	kennzahlen: Kennzahl[];
	handlung: Handlung[];
	auslastung: { von: string; bis: string; zeilen: AuslastungZeile[] };
	quellen: QuellenUmsatz[] | null;
};

/** Stunden je Arbeitstag für die Auslastung (Mo–Fr); Abwesenheiten zählen nicht. */
const STUNDEN_JE_TAG = 8;

const wochentag = (tag: string) => new Date(`${tag}T12:00:00Z`).getUTCDay();

export async function startCockpit(k: Kontext, sicht: Sicht, opt: { preise: boolean }, jetzt = new Date()): Promise<StartCockpit> {
	const heute = berlinTag(jetzt);
	const monat = zeitraum('monat', heute);
	const [kennzahlen, auftraege, angebote, auslastung, quellen, offen] = await Promise.all([
		cockpit(k, monat, opt.preise, jetzt),
		auftragsKennzahlen(k, sicht, zeitraum('alle', heute), opt.preise),
		angebotsKennzahlen(k, sicht, zeitraum('alle', heute), opt.preise, heute),
		zweiWochen(k, heute),
		opt.preise ? auswertung(k, `${heute.slice(0, 4)}-01-01`, heute) : Promise.resolve(null),
		offeneZahlen(k, heute)
	]);
	const handlung: Handlung[] = [
		{ id: 'nachfassen', titel: 'Nachfassen fällig', anzahl: auftraege.nachfassenFaellig, href: '/auftraege?nachfassen=faellig', ton: 'rot' as const },
		{ id: 'abgelaufen', titel: 'Angebote abgelaufen', anzahl: angebote.abgelaufen, href: '/angebote?status=versendet', ton: 'orange' as const },
		{ id: 'entwurf', titel: 'Angebots-Entwürfe', anzahl: angebote.entwurf, href: '/angebote?status=entwurf', ton: 'grau' as const },
		{ id: 'aufgaben', titel: 'Aufgaben überfällig', anzahl: offen.aufgabenUeberfaellig, href: '/todos?person=alle&status=in-arbeit', ton: 'rot' as const },
		{ id: 'ohne-termin', titel: 'Beauftragt ohne Termin', anzahl: offen.ohneTermin, href: '/auftraege?ansicht=liste&status=beauftragt', ton: 'blau' as const }
	];
	return {
		kennzahlen,
		handlung,
		auslastung,
		quellen: quellen
			? quellen
					.filter((q) => q.umsatzCent > 0 || q.auftraege > 0)
					.map((q) => ({ name: q.name, umsatzCent: q.umsatzCent, auftraege: q.auftraege }))
					.sort((a, b) => b.umsatzCent - a.umsatzCent || b.auftraege - a.auftraege)
			: null
	};
}

/** Überfällige offene Aufgaben (ganzer Betrieb) und beauftragte Aufträge ohne kommenden Termin. */
async function offeneZahlen(k: Kontext, heute: string): Promise<{ aufgabenUeberfaellig: number; ohneTermin: number }> {
	return mitBetrieb(k, async (tx) => {
		const [r] = await tx`
			select
				(select count(*) from app.todos t
					where t.betrieb_id = ${k.betriebId} and t.erledigt_am is null and t.faellig < ${heute}::date)::int as ueberfaellig,
				(select count(*) from app.auftraege a
					where a.betrieb_id = ${k.betriebId} and a.status = 'beauftragt'
						and not exists (select 1 from app.einsaetze e
							where e.betrieb_id = a.betrieb_id and e.auftrag_id = a.id and e.ende >= now()))::int as ohne_termin`;
		return { aufgabenUeberfaellig: r.ueberfaellig as number, ohneTermin: r.ohne_termin as number };
	});
}

/** Geplante Stunden je aktivem Mitarbeiter in den nächsten 14 Tagen gegen Mo–Fr × 8 h minus Abwesenheitstage. */
async function zweiWochen(k: Kontext, heute: string): Promise<StartCockpit['auslastung']> {
	const bis = tagPlus(heute, 14); // ausschließlich
	const leute = await aktiveMitarbeiter(k);
	const { beginn } = tagesGrenzen(heute);
	const { beginn: ende } = tagesGrenzen(bis);
	const [stunden, abwesend] = await mitBetrieb(k, async (tx) =>
		Promise.all([
			tx`
				select e.benutzer_id,
					sum(extract(epoch from (least(e.ende, ${ende}) - greatest(e.beginn, ${beginn})))) / 3600 as stunden
				from app.einsaetze e
				where e.betrieb_id = ${k.betriebId} and e.beginn < ${ende} and e.ende > ${beginn}
				group by e.benutzer_id`,
			tx`
				select benutzer_id, to_char(von, 'YYYY-MM-DD') as von, to_char(bis, 'YYYY-MM-DD') as bis
				from app.abwesenheiten
				where betrieb_id = ${k.betriebId} and von < ${bis}::date and bis >= ${heute}::date`
		])
	);
	const tage: string[] = [];
	for (let t = heute; t < bis; t = tagPlus(t, 1)) if (wochentag(t) >= 1 && wochentag(t) <= 5) tage.push(t);
	const geplant = new Map(stunden.map((r) => [r.benutzer_id as string, Number(r.stunden)]));
	const zeilen = leute.map((p) => {
		const frei = tage.filter((t) => abwesend.some((a) => a.benutzer_id === p.id && t >= a.von && t <= a.bis)).length;
		const verfuegbar = (tage.length - frei) * STUNDEN_JE_TAG;
		const g = Math.round((geplant.get(p.id) ?? 0) * 10) / 10;
		return { id: p.id, name: p.name, geplant: g, verfuegbar, prozent: verfuegbar > 0 ? Math.round((g / verfuegbar) * 100) : 0 };
	});
	return { von: heute, bis: tagPlus(bis, -1), zeilen: zeilen.sort((a, b) => b.prozent - a.prozent) };
}
