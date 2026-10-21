import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import {
	archiviereVorlage,
	dupliziereVorlage,
	legeVorlageAn,
	istVorlagenArt,
	listeVorlagen,
	uebernimmStartvorlagen,
	type VorlagenArt
} from '$lib/server/protokoll-formulare';
import { zugriffVorlagen } from '$lib/server/protokoll-zugriff';
import { leeresSchema, type Schema } from '$lib/protokoll-formular';
import { STARTVORLAGEN } from '$lib/protokoll-startvorlagen';

/** `?art=aufmass` → Aufmaß-Vorlagen (msg 2842), sonst Protokoll-Vorlagen – gleiche Seite, gleicher Baukasten. */
const artAus = (url: URL): VorlagenArt => {
	const a = url.searchParams.get('art');
	return istVorlagenArt(a) ? a : 'protokoll';
};
const beispieleFuer = (art: VorlagenArt) => STARTVORLAGEN.filter((s) => (s.art ?? 'protokoll') === art);

/** Leeres Aufmaß: ein wiederholbarer Raum mit Länge, Breite und berechneter Fläche. */
function leeresAufmass(): Schema {
	const s = leeresSchema();
	s.seiten[0].titel = 'Räume';
	s.seiten[0].abschnitte = [
		{
			id: s.seiten[0].abschnitte[0].id,
			titel: 'Raum',
			wiederholbar: true,
			wiederholName: 'Raum',
			felder: [
				{ id: `${s.seiten[0].abschnitte[0].felder[0].id}l`, typ: 'mass', label: 'Länge', kuerzel: 'L', einheit: 'm', pflicht: true },
				{ id: `${s.seiten[0].abschnitte[0].felder[0].id}b`, typ: 'mass', label: 'Breite', kuerzel: 'B', einheit: 'm', pflicht: true },
				{ id: `${s.seiten[0].abschnitte[0].felder[0].id}f`, typ: 'flaeche', label: 'Fläche', kuerzel: 'flaeche', formel: 'L * B' }
			]
		}
	];
	return s;
}

/** Einstellungen → Protokoll- bzw. Aufmaß-Vorlagen: Liste (aktuelle Versionen), neu, Beispiele übernehmen, duplizieren, archivieren. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
	const art = artAus(url);
	return alsSeitenFehler(async () => {
		const vorlagen = await listeVorlagen(k, { archivierte: true, art });
		const namen = new Set(vorlagen.map((v) => v.name.toLowerCase()));
		return {
			art,
			vorlagen,
			beispiele: beispieleFuer(art).filter((s) => !namen.has(s.name.toLowerCase())).map((s) => ({ schluessel: s.schluessel, name: s.name, beschreibung: s.beschreibung }))
		};
	});
};

const id = async (request: Request) => {
	const w = (await request.formData()).get('id');
	return typeof w === 'string' ? w : '';
};

export const actions: Actions = {
	neu: async ({ locals, url }) => {
		let neu: string;
		const art = artAus(url);
		try {
			neu = (await legeVorlageAn(await zugriffVorlagen(locals), art === 'aufmass' ? { name: 'Neues Aufmaß', schema: leeresAufmass(), art } : { name: 'Neue Vorlage', schema: leeresSchema() })).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/einstellungen/protokoll-vorlagen/${neu}`);
	},
	beispiele: async ({ locals, url }) => {
		try {
			return { uebernommen: await uebernimmStartvorlagen(await zugriffVorlagen(locals), beispieleFuer(artAus(url)).map((s) => s.schluessel)) };
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
