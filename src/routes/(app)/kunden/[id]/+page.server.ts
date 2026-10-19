import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeKunde, listeObjekte, loescheKunde } from '$lib/server/kunden';
import { liesProtokoll } from '$lib/server/protokoll';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf, hatModul } from '$lib/server/tarif';
import { listeAuftraege, sichtVon, type Auftrag } from '$lib/server/auftraege';
import { verlaufZeile } from '$lib/verlauf';

/**
 * Kunde mit Objekten, Aufträgen und Verlauf (Änderungsprotokoll, neueste zuerst). Fremde Kunden: 404.
 * Aufträge nur mit Modul `auftraege` und Leserecht (`null` = Bereich ausblenden); mit nur `auftraege.lesen` die eigenen.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	const nutzer = locals.nutzer!;
	const auftraegeLesbar =
		(hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen')) &&
		(await hatModul(k.betriebId, 'auftraege'));
	return alsSeitenFehler(async () => {
		const kunde = await holeKunde(k, params.id);
		const [objekte, protokoll, auftraege] = await Promise.all([
			listeObjekte(k, kunde.id),
			liesProtokoll(k, { tabelle: 'kunden', datensatz: kunde.id, vor: null }),
			auftraegeLesbar ? listeAuftraege(k, sichtVon(nutzer), { kundeId: kunde.id }) : null
		]);
		return {
			kunde,
			objekte,
			auftraege: auftraege as Auftrag[] | null,
			darfAuftragAnlegen: auftraegeLesbar && hatRecht(nutzer, 'auftraege.bearbeiten'),
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
