import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { listeTerminarten } from '$lib/server/buchung';
import { ladeEinstellung, speichereEinstellung } from '$lib/server/leitfaden';
import { listeVorlagen } from '$lib/server/protokoll-formulare';

/**
 * Einstellungen → Anfrage → Leitfaden beim Termin (Jamil msgs 4302/4304; 4340: 1c je Terminart, 3a einer je Firma):
 * ein/aus, Name, bei welchen Termin-Arten bzw. Terminarten er erscheint, Schritte. Recht „Einstellungen“, Modul Plantafel.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'plantafel', 'einstellungen');
	const [einstellung, terminarten, vorlagen] = await alsSeitenFehler(() => Promise.all([ladeEinstellung(k), listeTerminarten(k), listeVorlagen(k, { art: 'protokoll' })]));
	return {
		einstellung,
		terminarten: terminarten.map((t) => ({ id: t.id, name: t.name, farbe: t.farbe, aktiv: t.aktiv })),
		// Schritt „Protokoll ausfüllen“ (Jamil msg 4353): Vorlagen aus dem Protokoll-Baukasten (immer die aktuelle Version)
		protokollVorlagen: vorlagen.filter((v) => !v.archiviert).map((v) => ({ gruppeId: v.gruppeId, name: v.name }))
	};
};

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await darf(locals, 'plantafel', 'einstellungen');
			let schritte: unknown;
			try {
				schritte = JSON.parse(String(f.get('schritte') ?? '[]'));
			} catch {
				throw new ApiFehler(400, 'Die Schritte konnten nicht gelesen werden.');
			}
			await speichereEinstellung(betriebKontext(locals), {
				aktiv: f.get('aktiv') === 'on',
				name: f.get('name'),
				arten: f.getAll('arten'),
				terminarten: f.getAll('terminarten'),
				schritte
			});
		} catch (e) {
			return alsFormFehler(e);
		}
		return { gespeichert: true };
	}
};
