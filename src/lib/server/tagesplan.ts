import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { ortAus, kundeNameAus } from './auftraege';
import { hatRecht } from './rechte';
import { aktiveMitarbeiter } from './todos';
import { berlinTag, berlinUhrzeit, tagDeutsch, tagPlus, wochentag } from '../zeit';

/**
 * Tagesplan (Wunsch Jamil msg 2647): „Was steht heute für mich an?“ – Termine (Einsätze) mit Uhrzeit, Adresse und
 * Auftrag, dann fällige/überfällige Aufgaben, dann Nachfass-Aufgaben. Für die Sprachfrage (`abfrage_tagesplan`) und die
 * Kachel „Heute“ auf der Startseite. Nur lesend.
 *
 * Sichtbarkeit: Jeder darf seinen eigenen Plan sehen; den Plan anderer nur mit „Alle Aufgaben ansehen“
 * (`todos.alle_lesen`) – das gilt für Aufgaben UND Termine.
 */

export type PlanEintrag = { zeit: string; titel: string; ort: string | null; link: string; ueberfaellig: boolean };
export type Tagesplan = {
	person: { id: string; name: string };
	von: string;
	bis: string;
	/** „heute“, „morgen“, „diese Woche“ oder „am 23.10.2026“ */
	zeitraumText: string;
	termine: PlanEintrag[];
	todos: PlanEintrag[];
	nachfassen: PlanEintrag[];
	/** Zusammenfassung zum Vorlesen */
	text: string;
};

export type Zeitraum = 'heute' | 'morgen' | 'woche' | 'datum';

/** Zeitraum → [von, bis] (Berliner Tage, inklusive). „woche“ = heute bis Sonntag. */
export function zeitraumTage(z: Zeitraum, heute: string, datum?: string): { von: string; bis: string; text: string } {
	if (z === 'morgen') return { von: tagPlus(heute, 1), bis: tagPlus(heute, 1), text: 'morgen' };
	if (z === 'woche') return { von: heute, bis: tagPlus(heute, 6 - wochentag(heute)), text: 'diese Woche' };
	if (z === 'datum' && datum) return { von: datum, bis: datum, text: `am ${tagDeutsch(datum)}` };
	return { von: heute, bis: heute, text: 'heute' };
}

export function darfPlanSehen(nutzer: Nutzer, personId: string): boolean {
	return personId === nutzer.id || hatRecht(nutzer, 'todos.alle_lesen');
}

/** Personen, deren Plan der Nutzer sehen darf (für den Umschalter). */
export async function planPersonen(k: Kontext, nutzer: Nutzer): Promise<{ id: string; name: string }[]> {
	const alle = await aktiveMitarbeiter(k);
	return hatRecht(nutzer, 'todos.alle_lesen') ? alle : alle.filter((m) => m.id === nutzer.id);
}

const anzahl = (n: number, eins: string, viele: string) => `${n === 0 ? 'keine' : n} ${n === 1 ? eins : viele}`;

export async function tagesplan(
	k: Kontext,
	nutzer: Nutzer,
	personId: string,
	z: { von: string; bis: string; text: string },
	opts: { nurUeberfaellig?: boolean; jetzt?: Date } = {}
): Promise<Tagesplan> {
	if (!darfPlanSehen(nutzer, personId)) throw new ApiFehler(403, 'Sie dürfen nur Ihren eigenen Tagesplan abfragen.');
	const heute = berlinTag(opts.jetzt ?? new Date());
	return mitBetrieb(k, async (tx) => {
		const [person] = await tx`select id, name from app.benutzer where id = ${personId} and betrieb_id = ${k.betriebId}`;
		if (!person) throw new ApiFehler(404, 'Mitarbeiter nicht gefunden.');
		const termine = opts.nurUeberfaellig
			? []
			: await tx`
				select e.id, e.beginn, e.ende, e.art, a.id as auftrag_id, a.nummer, coalesce(a.titel, e.titel) as titel, a.objekt_id,
					o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort,
					k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
					k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort,
					a.einmal_name, a.einmal_strasse, a.einmal_plz, a.einmal_ort
				from app.einsaetze e
				left join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
				left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
				left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
				where e.betrieb_id = ${k.betriebId} and e.benutzer_id = ${personId}
					and (e.beginn at time zone 'Europe/Berlin')::date <= ${z.bis}::date
					and (e.ende at time zone 'Europe/Berlin')::date >= ${z.von}::date
				order by e.beginn, e.id
				limit 50`;
		const todos = await tx`
			select t.id, t.titel, to_char(t.faellig, 'YYYY-MM-DD') as faellig, to_char(t.von_tag, 'YYYY-MM-DD') as von_tag, t.auftrag_id, t.nachfass_id, nl.angebot_id
			from app.todos t
			left join app.nachfass_laeufe nl on nl.id = t.nachfass_id and nl.betrieb_id = t.betrieb_id
			where t.betrieb_id = ${k.betriebId} and t.erledigt_am is null
				and (t.zustaendig_id = ${personId} or exists (
					select 1 from app.todo_mitarbeiter tm where tm.todo_id = t.id and tm.betrieb_id = t.betrieb_id and tm.benutzer_id = ${personId}))
				and t.faellig is not null
				and ${opts.nurUeberfaellig ? tx`t.faellig < ${heute}::date` : tx`t.faellig <= ${z.bis}::date`}
			order by t.faellig, t.titel
			limit 50`;
		const terminEintraege: PlanEintrag[] = termine.map((t) => {
			const b = new Date(t.beginn);
			const e = new Date(t.ende);
			const tag = berlinTag(b);
			return {
				zeit: `${z.von !== z.bis ? `${tagDeutsch(tag).slice(0, 6)} ` : ''}${berlinUhrzeit(b)}–${berlinUhrzeit(e)}`,
				titel: t.auftrag_id ? `${t.titel} – ${kundeNameAus(t)}` : `📌 ${t.titel}`,
				ort: t.auftrag_id ? ortAus(t) : null,
				link: t.auftrag_id ? `/auftraege/${t.auftrag_id}` : `/plantafel?ansicht=tag&tag=${tag}`,
				ueberfaellig: false
			};
		});
		const zuTodo = (t: Record<string, any>): PlanEintrag => ({
			zeit: t.faellig < heute
				? `überfällig seit ${tagDeutsch(t.faellig).slice(0, 6)}`
				: t.von_tag
					? `${tagDeutsch(t.von_tag).slice(0, 6)}–${tagDeutsch(t.faellig).slice(0, 6)}`
					: t.faellig === heute
						? 'heute'
						: tagDeutsch(t.faellig).slice(0, 6),
			titel: t.titel,
			ort: null,
			link: t.angebot_id ? `/angebote/${t.angebot_id}#nachfassen` : t.auftrag_id ? `/auftraege/${t.auftrag_id}` : '/todos',
			ueberfaellig: t.faellig < heute
		});
		const normal = todos.filter((t) => !t.nachfass_id).map(zuTodo);
		const nachfassen = todos.filter((t) => t.nachfass_id).map(zuTodo);
		const ich = personId === nutzer.id;
		const wer = ich ? 'Du hast' : `${person.name} hat`;
		const ueber = [...normal, ...nachfassen].filter((t) => t.ueberfaellig).length;
		const teile = opts.nurUeberfaellig
			? [`${wer} ${anzahl(normal.length + nachfassen.length, 'überfällige Aufgabe', 'überfällige Aufgaben')}.`]
			: [
					`${wer} ${z.text} ${anzahl(terminEintraege.length, 'Termin', 'Termine')}${terminEintraege.length > 0 ? ': ' + terminEintraege.slice(0, 5).map((t) => `${t.zeit.replace('–', ' bis ')} ${t.titel}${t.ort ? `, ${t.ort}` : ''}`).join('; ') : ''}.`,
					`Dazu ${anzahl(normal.length, 'Aufgabe', 'Aufgaben')}${ueber > 0 ? `, davon ${ueber} überfällig` : ''}${nachfassen.length > 0 ? `, und ${anzahl(nachfassen.length, 'Nachfass-Aufgabe', 'Nachfass-Aufgaben')}` : ''}.`
				];
		return {
			person: { id: person.id, name: person.name },
			von: z.von,
			bis: z.bis,
			zeitraumText: z.text,
			termine: terminEintraege,
			todos: normal,
			nachfassen,
			text: teile.join(' ')
		};
	});
}

/**
 * „Was hat Kolonne A diese Woche?“ – Termine der Kolonne (je Gruppe und Tag einer). Sehen darf, wer Mitglied ist oder
 * „Alle Aufgaben ansehen“ hat.
 */
export async function kolonnenplan(
	k: Kontext,
	nutzer: Nutzer,
	kolonne: { id: string; name: string; mitglieder: { id: string; name: string }[] },
	z: { von: string; bis: string; text: string }
): Promise<Tagesplan> {
	if (!hatRecht(nutzer, 'todos.alle_lesen') && !kolonne.mitglieder.some((m) => m.id === nutzer.id)) {
		throw new ApiFehler(403, 'Sie dürfen nur Ihren eigenen Tagesplan und den Ihrer Kolonne abfragen.');
	}
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			select distinct on (coalesce(e.gruppe_id, e.id), (e.beginn at time zone 'Europe/Berlin')::date)
				e.id, e.beginn, e.ende, a.id as auftrag_id, a.titel, a.objekt_id,
				o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort,
				k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
				k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort,
				a.einmal_name, a.einmal_strasse, a.einmal_plz, a.einmal_ort
			from app.einsaetze e
			join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
			left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
			left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
			where e.betrieb_id = ${k.betriebId} and e.kolonne_id = ${kolonne.id}
				and (e.beginn at time zone 'Europe/Berlin')::date between ${z.von}::date and ${z.bis}::date
			order by coalesce(e.gruppe_id, e.id), (e.beginn at time zone 'Europe/Berlin')::date, e.beginn
			limit 100`;
		const termine: PlanEintrag[] = zeilen
			.map((t) => {
				const b = new Date(t.beginn);
				return {
					sort: b.getTime(),
					zeit: `${z.von !== z.bis ? `${tagDeutsch(berlinTag(b)).slice(0, 6)} ` : ''}${berlinUhrzeit(b)}–${berlinUhrzeit(new Date(t.ende))}`,
					titel: `${t.titel} – ${kundeNameAus(t)}`,
					ort: ortAus(t),
					link: `/auftraege/${t.auftrag_id}`,
					ueberfaellig: false
				};
			})
			.sort((x, y) => x.sort - y.sort)
			.map(({ sort: _s, ...e }) => e);
		return {
			person: { id: kolonne.id, name: kolonne.name },
			von: z.von,
			bis: z.bis,
			zeitraumText: z.text,
			termine,
			todos: [],
			nachfassen: [],
			text: `${kolonne.name} hat ${z.text} ${anzahl(termine.length, 'Termin', 'Termine')}${termine.length > 0 ? ': ' + termine.slice(0, 6).map((t) => `${t.zeit.replace('–', ' bis ')} ${t.titel}${t.ort ? `, ${t.ort}` : ''}`).join('; ') : ''}.`
		};
	});
}
