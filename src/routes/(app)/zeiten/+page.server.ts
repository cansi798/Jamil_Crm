import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { gebeFrei, korrigiere, listeTaetigkeiten, loescheZeit, nachweis, trageNach, zeitZugriff } from '$lib/server/zeiterfassung';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { listeAuftraege, sichtVon } from '$lib/server/auftraege';
import { berlinTag, istTag, tagPlus, wocheVon } from '$lib/zeit';

/**
 * Arbeitszeitnachweis (Wunsch Jamil msgs 2770–2774): Tag oder Woche je Mitarbeiter, Einträge mit Korrektur (Grund
 * Pflicht), Nachtragen, Freigabe (Chef/Büro), Export CSV/PDF. Monteure sehen nur sich selbst.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	await seitenZugriff(locals, 'zeiterfassung', ['zeiten.erfassen', 'zeiten.verwalten']);
	return alsSeitenFehler(async () => {
		const z = await zeitZugriff(locals);
		const heute = berlinTag(new Date());
		const tagParam = url.searchParams.get('tag');
		const tag = istTag(tagParam) ? tagParam : heute;
		const ansicht = url.searchParams.get('ansicht') === 'tag' ? 'tag' : 'woche';
		const woche = wocheVon(tag);
		const [von, bis] = ansicht === 'tag' ? [tag, tag] : [woche[0], woche[6]];
		const person = url.searchParams.get('person') ?? undefined;
		const n = await nachweis(z, { benutzerId: person, von, bis });
		const auftragFilter = url.searchParams.get('auftrag');
		const [personen, taetigkeiten, auftraege] = await Promise.all([
			z.verwalten ? aktiveMitarbeiter(z.k) : Promise.resolve([]),
			listeTaetigkeiten(z.k),
			listeAuftraege(z.k, sichtVon(z.nutzer), { offen: true })
		]);
		return {
			n,
			ansicht,
			tag,
			heute,
			vorher: tagPlus(tag, ansicht === 'tag' ? -1 : -7),
			nachher: tagPlus(tag, ansicht === 'tag' ? 1 : 7),
			verwalten: z.verwalten,
			ichId: z.nutzer.id,
			personen,
			taetigkeiten,
			auftraege: auftraege.map((a) => ({ id: a.id, label: `${a.nummer} ${a.titel} – ${a.kundeName}` })),
			auftragFilter: auftragFilter && /^[0-9a-f-]{36}$/i.test(auftragFilter) ? auftragFilter : null
		};
	});
};

const werte = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, w]) => typeof w === 'string')) as Record<string, string>;
const meldung = (e: unknown) => (e instanceof ApiFehler ? e.message : 'Interner Fehler. Bitte später erneut versuchen.');

export const actions: Actions = {
	nachtragen: async ({ locals, request }) => {
		try {
			await trageNach(await zeitZugriff(locals), werte(await request.formData()));
			return { erfolg: 'Zeit nachgetragen.' };
		} catch (e) {
			return alsFormFehler(e, { nachtragenFehler: meldung(e) });
		}
	},
	korrigieren: async ({ locals, request }) => {
		const w = werte(await request.formData());
		try {
			await korrigiere(await zeitZugriff(locals), w.id, w);
			return { erfolg: 'Korrektur gespeichert.' };
		} catch (e) {
			return alsFormFehler(e, { korrekturFehler: meldung(e), korrekturId: w.id });
		}
	},
	loeschen: async ({ locals, request }) => {
		const w = werte(await request.formData());
		try {
			await loescheZeit(await zeitZugriff(locals), w.id, w.grund);
			return { erfolg: 'Eintrag gelöscht.' };
		} catch (e) {
			return alsFormFehler(e, { korrekturFehler: meldung(e), korrekturId: w.id });
		}
	},
	freigeben: async ({ locals, request }) => {
		const w = werte(await request.formData());
		try {
			const n = await gebeFrei(await zeitZugriff(locals), w.person, w.von, w.bis);
			return { erfolg: n > 0 ? `${n} Einträge freigegeben.` : 'Es gab nichts mehr freizugeben.' };
		} catch (e) {
			return alsFormFehler(e, { freigabeFehler: meldung(e) });
		}
	}
};
