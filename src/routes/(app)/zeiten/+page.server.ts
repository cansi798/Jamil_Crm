import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { gebeFrei, korrigiere, loescheZeit, nachweis, teamUebersicht, trageNach, zeitZugriff } from '$lib/server/zeiterfassung';
import { istMonat, monatsTage } from '$lib/zeiterfassung';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { listeAuftraege, sichtVon } from '$lib/server/auftraege';
import { berlinTag, istTag, tagPlus, wocheVon } from '$lib/zeit';

/**
 * Arbeitszeitnachweis (Wunsch Jamil msgs 2770–2774): Tag oder Woche je Mitarbeiter, Einträge mit Korrektur (Grund
 * Pflicht), Nachtragen, Freigabe (Chef/Büro), Export CSV/PDF. Monteure sehen nur sich selbst.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	await seitenZugriff(locals, 'zeiterfassung', ['zeiterfassung.nutzen', 'zeiterfassung.alle_sehen']);
	return alsSeitenFehler(async () => {
		const z = await zeitZugriff(locals);
		const heute = berlinTag(new Date());
		const tagParam = url.searchParams.get('tag');
		const tag = istTag(tagParam) ? tagParam : heute;
		const a = url.searchParams.get('ansicht');
		const ansicht: 'tag' | 'woche' | 'monat' = a === 'tag' || a === 'monat' ? a : 'woche';
		const woche = wocheVon(tag);
		const monatParam = url.searchParams.get('monat');
		const monat = istMonat(monatParam) ? monatParam : tag.slice(0, 7);
		const mt = monatsTage(monat);
		const [von, bis] = ansicht === 'tag' ? [tag, tag] : ansicht === 'monat' ? [mt[0], mt.at(-1)!] : [woche[0], woche[6]];
		const person = url.searchParams.get('person') ?? undefined;
		const n = await nachweis(z, { benutzerId: person, von, bis });
		const auftragFilter = url.searchParams.get('auftrag');
		const [personen, auftraege] = await Promise.all([
			z.verwalten ? aktiveMitarbeiter(z.k) : Promise.resolve([]),
			listeAuftraege(z.k, sichtVon(z.nutzer), { offen: true })
		]);
		// Teamübersicht (Chef/Büro, msg 2797): eine Zeile je Mitarbeiter
		const team = z.verwalten && ansicht === 'monat' ? await teamUebersicht(z, von, bis) : null;
		const monatPlus = (n: number) => {
			const [j, m] = monat.split('-').map(Number);
			const d = new Date(Date.UTC(j, m - 1 + n, 1));
			return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
		};
		return {
			n,
			ansicht,
			tag,
			heute,
			monat,
			team,
			vorher: ansicht === 'monat' ? `${monatPlus(-1)}-01` : tagPlus(tag, ansicht === 'tag' ? -1 : -7),
			nachher: ansicht === 'monat' ? `${monatPlus(1)}-01` : tagPlus(tag, ansicht === 'tag' ? 1 : 7),
			vorherMonat: monatPlus(-1),
			nachherMonat: monatPlus(1),
			verwalten: z.verwalten,
			ichId: z.nutzer.id,
			personen,
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
