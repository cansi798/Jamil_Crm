import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { hatRecht } from '$lib/server/rechte';
import { holeKennzahlEinstellungen, kennzahlEinstellungenZugriff, speichereKennzahlEinstellungen } from '$lib/server/kennzahlen';
import { KONFIG_IDS } from '$lib/kennzahlen';

/** Einstellungen → Kennzahlen (Jamil msg 2946): je Kennzahl an/aus und „Erfassen ab“ – Recht „Kennzahlen einstellen“. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'kennzahlen.verwalten') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	return { zeilen: await holeKennzahlEinstellungen(kennzahlEinstellungenZugriff(locals)) };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = kennzahlEinstellungenZugriff(locals);
			const eingabe = Object.fromEntries(KONFIG_IDS.map((id) => [id, { aktiv: f.get(`aktiv_${id}`) === 'on', ab: f.get(`ab_${id}`) ?? '' }]));
			await speichereKennzahlEinstellungen(k, eingabe);
			return { ok: 'Gespeichert – gilt sofort für Cockpit, Kacheln und Start.' };
		} catch (e) {
			return alsFormFehler(e, { fehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	}
};
