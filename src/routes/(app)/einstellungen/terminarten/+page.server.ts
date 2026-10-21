import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { aendereDienst, buchungZugriff, legeDienstAn, listeDienste, mitarbeiterAus, verschiebeDienst } from '$lib/server/buchung';

/**
 * Einstellungen → Terminarten (Jamil msg 3074): EINE gepflegte Liste je Betrieb – wählbar im Einsatz-Dialog der
 * Plantafel und (wenn „Online buchbar“) in der Online-Buchung. Anlegen, Reihenfolge, ein-/ausschalten; Details auf der
 * Seite der Terminart. Recht „Terminarten und Online-Buchung verwalten“ (`buchung.verwalten`).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	await alsSeitenFehler(() => buchungZugriff(locals));
	const k = betriebKontext(locals);
	const [terminarten, mitarbeiter] = await Promise.all([listeDienste(k), aktiveMitarbeiter(k)]);
	return { terminarten, mitarbeiter };
};

async function ausfuehren(locals: App.Locals, bereich: string, fn: () => Promise<unknown>) {
	try {
		await buchungZugriff(locals);
		await fn();
		return { bereich, ok: true };
	} catch (e) {
		return alsFormFehler(e, { bereich });
	}
}

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const f = await request.formData();
		let id: string;
		try {
			await buchungZugriff(locals);
			const d = await legeDienstAn(
				betriebKontext(locals),
				{
					name: f.get('name') ?? '',
					dauerMin: f.get('dauerMin') ?? '',
					farbe: f.get('farbe') ?? '',
					onlineBuchbar: f.get('onlineBuchbar') === 'on',
					modus: f.get('modus') ?? ''
				},
				mitarbeiterAus(f) ?? []
			);
			id = d.id;
		} catch (e) {
			return alsFormFehler(e, { bereich: 'neu' });
		}
		redirect(303, `/einstellungen/terminarten/${id}`);
	},
	verschieben: async ({ locals, request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		return ausfuehren(locals, id, () => verschiebeDienst(betriebKontext(locals), id, f.get('richtung')));
	},
	/** Schalter in der Liste: „eingeschaltet“ bzw. „online buchbar“ (je ein Feld, die anderen Angaben bleiben). */
	schalten: async ({ locals, request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const feld = f.get('feld');
		return ausfuehren(locals, id, async () => {
			if (feld !== 'aktiv' && feld !== 'onlineBuchbar') throw new ApiFehler(400, 'Ungültige Einstellung.');
			await aendereDienst(betriebKontext(locals), id, { [feld]: f.get('wert') === 'on' });
		});
	}
};
