import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { aendereTaetigkeit, legeTaetigkeitAn, listeTaetigkeiten, loescheTaetigkeit, zeitVerwaltung } from '$lib/server/zeiterfassung';

/** Einstellungen → Zeiterfassung: „Tätigkeiten ohne Auftrag“ (Jamil msg 2776) – Chef/Büro (`zeiten.verwalten`). */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'zeiterfassung', 'zeiten.verwalten');
	return alsSeitenFehler(async () => ({ taetigkeiten: await listeTaetigkeiten(k) }));
};

const m = (e: unknown) => (e instanceof ApiFehler ? e.message : 'Interner Fehler.');

export const actions: Actions = {
	neu: async ({ locals, request }) => {
		try {
			const z = await zeitVerwaltung(locals);
			await legeTaetigkeitAn(z.k, (await request.formData()).get('name'));
		} catch (e) {
			return alsFormFehler(e, { taetigkeitFehler: m(e) });
		}
	},
	aendern: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const z = await zeitVerwaltung(locals);
			await aendereTaetigkeit(z.k, f.get('id'), { name: f.get('name') ?? undefined, aktiv: f.has('aktiv') ? f.get('aktiv') === 'ja' : undefined });
		} catch (e) {
			return alsFormFehler(e, { taetigkeitFehler: m(e) });
		}
	},
	loeschen: async ({ locals, request }) => {
		try {
			const z = await zeitVerwaltung(locals);
			const r = await loescheTaetigkeit(z.k, (await request.formData()).get('id'));
			return { meldung: r === 'ausgeblendet' ? 'Auf diese Tätigkeit sind schon Zeiten gebucht – sie wurde ausgeblendet statt gelöscht.' : 'Gelöscht.' };
		} catch (e) {
			return alsFormFehler(e, { taetigkeitFehler: m(e) });
		}
	}
};
