import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { buchungZugriff, holeZeiten, legeAusnahmeAn, listeDienste, loescheAusnahme, speichereArbeitszeiten } from '$lib/server/buchung';
import { UUID } from '$lib/server/kunden';

/**
 * Arbeitszeiten für die Online-Buchung je Mitarbeiter (Wochentage mit Zeiten, für alle Dienste oder abweichend für
 * einen Dienst) und Ausnahmen (frei / zusätzlich). Termine der Plantafel, Urlaub und Buchungen zieht die Rechnung
 * selbst ab.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	await alsSeitenFehler(() => buchungZugriff(locals));
	const k = betriebKontext(locals);
	const [mitarbeiter, dienste] = await Promise.all([aktiveMitarbeiter(k), listeDienste(k)]);
	const ma = url.searchParams.get('ma');
	const benutzerId = ma && UUID.test(ma) && mitarbeiter.some((m) => m.id === ma) ? ma : (mitarbeiter[0]?.id ?? null);
	const dienstRoh = url.searchParams.get('dienst');
	const dienstId = dienstRoh && dienste.some((d) => d.id === dienstRoh) ? dienstRoh : null;
	const zeiten = benutzerId ? await alsSeitenFehler(() => holeZeiten(k, benutzerId)) : null;
	return {
		mitarbeiter,
		dienste: dienste.map((d) => ({ id: d.id, name: d.name, mitarbeiter: d.mitarbeiter.map((m) => m.id) })),
		benutzerId,
		dienstId,
		zeiten
	};
};

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await buchungZugriff(locals);
			let zeiten: unknown;
			try {
				zeiten = JSON.parse(String(f.get('zeiten') ?? '[]'));
			} catch {
				zeiten = null;
			}
			await speichereArbeitszeiten(betriebKontext(locals), f.get('benutzerId'), f.get('dienstId') || null, zeiten);
			return { bereich: 'zeiten', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'zeiten' });
		}
	},
	ausnahme: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await buchungZugriff(locals);
			await legeAusnahmeAn(betriebKontext(locals), f.get('benutzerId'), {
				tag: f.get('tag'),
				art: f.get('art'),
				von: f.get('von') ?? '',
				bis: f.get('bis') ?? '',
				notiz: f.get('notiz') ?? ''
			});
			return { bereich: 'ausnahme', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'ausnahme' });
		}
	},
	ausnahmeLoeschen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await buchungZugriff(locals);
			await loescheAusnahme(betriebKontext(locals), f.get('id'));
			return { bereich: 'ausnahme', geloescht: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'ausnahme' });
		}
	}
};
