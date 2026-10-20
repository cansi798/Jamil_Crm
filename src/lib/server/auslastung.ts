import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { ladeKalkulation } from './kalkulation';
import { auslastungZeile, breakEven, istMonat, monatsGrenzen, verfuegbareStunden, type AuslastungZeile, type BreakEven } from '../auslastung';
import { berlinTag, berlinZeitpunkt } from '../zeit';

/**
 * Auslastung je Mitarbeiter und Monat (Plantafel) und Break-even des Betriebs (Wunsch Jamil msg 2476, Punkte 4 und 5).
 * Kapazität aus der Kalkulation (produktive Stunden der Kalkulations-Mitarbeiter, über „Benutzer“ mit der Plantafel
 * verknüpft), geplant aus den Einsätzen. Geldwerte (`geld`) nur, wenn der Aufrufer „Preise sehen“ geprüft hat.
 */

export type AuslastungPerson = AuslastungZeile & { benutzerId: string | null; name: string; hinweis: string | null };

export type MonatsGeld = BreakEven & {
	/** Angenommene Angebote, deren Aufträge noch gar nicht eingeplant sind (netto) – kommen erst mit Terminen in einen Monat. */
	nichtEingeplantCent: number;
	auftraegeImMonat: number;
};

export type Auslastung = {
	monat: string;
	personen: AuslastungPerson[];
	summe: AuslastungZeile;
	/** Keine Kalkulations-Mitarbeiter erfasst – verfügbare Stunden und Monatskosten fehlen. */
	kalkulationFehlt: boolean;
	geld: MonatsGeld | null;
};

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monatText = (monat: string) => `${MONATE[Number(monat.slice(5, 7)) - 1]} ${monat.slice(0, 4)}`;
export const dieserMonat = (jetzt = new Date()) => berlinTag(jetzt).slice(0, 7);

export function pruefeMonat(w: unknown, jetzt = new Date()): string {
	if (w === null || w === undefined || w === '') return dieserMonat(jetzt);
	if (!istMonat(w)) throw new ApiFehler(400, 'Ungültiger Monat (JJJJ-MM).');
	return w;
}

export async function ladeAuslastung(k: Kontext, monat: string, opts: { mitGeld: boolean }): Promise<Auslastung> {
	const { von, bis } = monatsGrenzen(monat);
	const ab = berlinZeitpunkt(von);
	const ende = berlinZeitpunkt(bis);
	const kalk = await ladeKalkulation(k);
	const { geplant, auftraege } = await mitBetrieb(k, async (tx) => {
		const geplant = await tx`
			select b.id, b.name, coalesce(sum(extract(epoch from least(e.ende, ${ende}) - greatest(e.beginn, ${ab}))) / 3600, 0)::float8 as stunden
			from app.einsaetze e join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id
			where e.betrieb_id = ${k.betriebId} and e.beginn < ${ende} and e.ende > ${ab}
			group by b.id, b.name`;
		const auftraege = opts.mitGeld
			? await tx`
				with an as (
					select an.auftrag_id,
						sum(round(p.menge * p.einzelpreis_cent))::float8 as netto,
						sum(round(p.menge * coalesce(p.material_cent, 0)))::float8 as material
					from app.angebote an
					join app.angebot_positionen p on p.angebot_id = an.id and p.betrieb_id = an.betrieb_id
					where an.betrieb_id = ${k.betriebId} and an.status = 'angenommen'
					group by an.auftrag_id
				),
				e as (
					select e.auftrag_id,
						sum(extract(epoch from e.ende - e.beginn)) / 3600 as gesamt,
						coalesce(sum(extract(epoch from least(e.ende, ${ende}) - greatest(e.beginn, ${ab})))
							filter (where e.beginn < ${ende} and e.ende > ${ab}), 0) / 3600 as im_monat
					from app.einsaetze e where e.betrieb_id = ${k.betriebId}
					group by e.auftrag_id
				)
				select an.netto, an.material, coalesce(e.gesamt, 0)::float8 as gesamt, coalesce(e.im_monat, 0)::float8 as im_monat
				from an left join e on e.auftrag_id = an.auftrag_id`
			: [];
		return { geplant, auftraege };
	});

	const geplantJe = new Map(geplant.map((g) => [g.id as string, { name: g.name as string, stunden: Number(g.stunden) }]));
	const personen: AuslastungPerson[] = [];
	const verknuepft = new Set<string>();
	kalk.mitarbeiter.forEach((m, i) => {
		const jahr = kalk.uebersicht.mitarbeiter[i]?.stunden ?? 0;
		const verfuegbar = verfuegbareStunden(jahr, monat);
		if (m.benutzerId) {
			verknuepft.add(m.benutzerId);
			const g = geplantJe.get(m.benutzerId);
			personen.push({ ...auslastungZeile(verfuegbar, g?.stunden ?? 0), benutzerId: m.benutzerId, name: m.name, hinweis: null });
		} else {
			personen.push({
				...auslastungZeile(verfuegbar, 0),
				benutzerId: null,
				name: m.name,
				hinweis: 'Nicht mit einem Benutzer verknüpft – Termine zählen nicht (in der Kalkulation „Benutzer“ wählen).'
			});
		}
	});
	for (const [id, g] of geplantJe) {
		if (verknuepft.has(id)) continue;
		personen.push({ ...auslastungZeile(null, g.stunden), benutzerId: id, name: g.name, hinweis: 'Nicht in der Kalkulation – keine verfügbaren Stunden bekannt.' });
	}

	const mitKapazitaet = personen.filter((p) => p.verfuegbar !== null);
	const summeVerfuegbar = Math.round(mitKapazitaet.reduce((s, p) => s + p.verfuegbar!, 0) * 10) / 10;
	const summe = auslastungZeile(summeVerfuegbar, mitKapazitaet.reduce((s, p) => s + p.geplant, 0));
	// frei als Summe der freien Stunden je Person (Überbuchung eines Mitarbeiters macht andere nicht frei)
	summe.frei = Math.round(mitKapazitaet.reduce((s, p) => s + (p.frei ?? 0), 0) * 10) / 10;

	let geld: MonatsGeld | null = null;
	if (opts.mitGeld) {
		const anteile = auftraege.map((a) => ({
			nettoCent: Number(a.netto),
			materialCent: Number(a.material),
			stundenGesamt: Number(a.gesamt),
			stundenImMonat: Number(a.im_monat)
		}));
		geld = {
			...breakEven(kalk.uebersicht.monatskostenCent, anteile),
			nichtEingeplantCent: anteile.filter((a) => a.stundenGesamt <= 0).reduce((s, a) => s + a.nettoCent, 0),
			auftraegeImMonat: anteile.filter((a) => a.stundenImMonat > 0).length
		};
	}
	return { monat, personen, summe, kalkulationFehlt: kalk.mitarbeiter.length === 0, geld };
}
