import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import {
	archiviereVorlage,
	dupliziereVorlage,
	legeVorlageAn,
	listeVorlagen,
	uebernimmStartvorlagen
} from '$lib/server/protokoll-formulare';
import { zugriffVorlagen } from '$lib/server/protokoll-zugriff';
import { leeresSchema } from '$lib/protokoll-formular';
import { STARTVORLAGEN } from '$lib/protokoll-startvorlagen';

/** Einstellungen → Protokoll-Vorlagen: Liste (aktuelle Versionen), neu, Beispiele übernehmen, duplizieren, archivieren. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
	return alsSeitenFehler(async () => {
		const vorlagen = await listeVorlagen(k, { archivierte: true });
		const namen = new Set(vorlagen.map((v) => v.name.toLowerCase()));
		return {
			vorlagen,
			beispiele: STARTVORLAGEN.filter((s) => !namen.has(s.name.toLowerCase())).map((s) => ({ schluessel: s.schluessel, name: s.name, beschreibung: s.beschreibung }))
		};
	});
};

const id = async (request: Request) => {
	const w = (await request.formData()).get('id');
	return typeof w === 'string' ? w : '';
};

export const actions: Actions = {
	neu: async ({ locals }) => {
		let neu: string;
		try {
			neu = (await legeVorlageAn(await zugriffVorlagen(locals), { name: 'Neue Vorlage', schema: leeresSchema() })).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/einstellungen/protokoll-vorlagen/${neu}`);
	},
	beispiele: async ({ locals }) => {
		try {
			return { uebernommen: await uebernimmStartvorlagen(await zugriffVorlagen(locals)) };
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	duplizieren: async ({ locals, request }) => {
		let neu: string;
		try {
			neu = (await dupliziereVorlage(await zugriffVorlagen(locals), await id(request))).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/einstellungen/protokoll-vorlagen/${neu}`);
	},
	archivieren: async ({ locals, request }) => {
		try {
			await archiviereVorlage(await zugriffVorlagen(locals), await id(request), true);
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	wiederherstellen: async ({ locals, request }) => {
		try {
			await archiviereVorlage(await zugriffVorlagen(locals), await id(request), false);
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
