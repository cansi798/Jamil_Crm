import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeKunde, listeObjekte, loescheKunde } from '$lib/server/kunden';
import { liesProtokoll } from '$lib/server/protokoll';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { verlaufZeile } from '$lib/verlauf';

/** Kunde mit Objekten und Verlauf (Änderungsprotokoll, neueste zuerst). Fremde Kunden: 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	return alsSeitenFehler(async () => {
		const kunde = await holeKunde(k, params.id);
		const [objekte, protokoll] = await Promise.all([
			listeObjekte(k, kunde.id),
			liesProtokoll(k, { tabelle: 'kunden', datensatz: kunde.id, vor: null })
		]);
		return {
			kunde,
			objekte,
			verlauf: protokoll.eintraege.map(verlaufZeile),
			verlaufGekuerzt: protokoll.naechsteVor !== null,
			darfBearbeiten: hatRecht(locals.nutzer!, 'kunden.bearbeiten')
		};
	});
};

export const actions: Actions = {
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await loescheKunde(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, '/kunden');
	}
};
