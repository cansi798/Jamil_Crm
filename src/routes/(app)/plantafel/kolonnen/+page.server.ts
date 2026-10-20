import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { seitenZugriff } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { listeKolonnen, loescheKolonne, speichereKolonne } from '$lib/server/kolonnen';
import { darfPlanen } from '$lib/server/plantafel';

/** Kolonnen verwalten (Wunsch Jamil msg 2510) – wer die Plantafel bearbeiten darf. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'plantafel', 'plantafel.bearbeiten');
	const [kolonnen, mitarbeiter] = await Promise.all([listeKolonnen(k), aktiveMitarbeiter(k)]);
	return { kolonnen, mitarbeiter };
};

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const werte = {
			name: String(f.get('name') ?? ''),
			leiterId: String(f.get('leiterId') ?? ''),
			fahrzeug: String(f.get('fahrzeug') ?? ''),
			aktiv: f.get('aktiv') ?? 'true',
			mitglieder: f.getAll('mitglieder').map(String)
		};
		try {
			await darfPlanen(locals);
			await speichereKolonne(betriebKontext(locals), id || null, werte);
		} catch (e) {
			return alsFormFehler(e, { bereich: id || 'neu', werte });
		}
		return { bereich: id || 'neu', gespeichert: true };
	},
	loeschen: async ({ locals, request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		try {
			await darfPlanen(locals);
			await loescheKolonne(betriebKontext(locals), id);
		} catch (e) {
			return alsFormFehler(e, { bereich: id });
		}
	}
};
