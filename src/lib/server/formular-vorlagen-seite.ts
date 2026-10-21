import { redirect, type Actions, type RequestEvent } from '@sveltejs/kit';
import { alsFormFehler } from './fehler';
import { alsSeitenFehler, seitenZugriff } from './seite';
import {
	archiviereVorlage,
	dupliziereVorlage,
	holeVorlage,
	legeVorlageAn,
	listeVorlagen,
	loescheVorlage,
	uebernimmStartvorlagen,
	type VorlagenArt
} from './protokoll-formulare';
import { zugriffVorlagen } from './protokoll-zugriff';
import { listeKatalog } from './katalog';
import { hatModul } from './tarif';
import { leeresSchema, type Schema } from '../protokoll-formular';
import { STARTVORLAGEN } from '../protokoll-startvorlagen';
import { formularVorlagenPfad } from '../formular-vorlagen';

/**
 * Serverteil der Seiten „Protokoll-Vorlagen“ und „Aufmaß-Vorlagen“ (gleicher Baukasten, eigene Adressen – Jamil
 * msg 3085). Beide Routen rufen nur diese Fabriken mit ihrer Art auf.
 */
const beispieleFuer = (art: VorlagenArt) => STARTVORLAGEN.filter((s) => (s.art ?? 'protokoll') === art);

/** Leeres Aufmaß: ein wiederholbarer Raum mit Länge, Breite und berechneter Fläche. */
function leeresAufmass(): Schema {
	const s = leeresSchema();
	const a = s.seiten[0].abschnitte[0];
	const f = a.felder[0].id;
	s.seiten[0].titel = 'Räume';
	s.seiten[0].abschnitte = [
		{
			id: a.id,
			titel: 'Raum',
			wiederholbar: true,
			wiederholName: 'Raum',
			felder: [
				{ id: `${f}l`, typ: 'mass', label: 'Länge', kuerzel: 'L', einheit: 'm', pflicht: true },
				{ id: `${f}b`, typ: 'mass', label: 'Breite', kuerzel: 'B', einheit: 'm', pflicht: true },
				{ id: `${f}f`, typ: 'flaeche', label: 'Fläche', kuerzel: 'flaeche', formel: 'L * B' }
			]
		}
	];
	return s;
}

const formId = async (request: Request) => {
	const w = (await request.formData()).get('id');
	return typeof w === 'string' ? w : '';
};

/** Liste: aktuelle Versionen (auch archivierte) und noch nicht übernommene Beispiele. */
export function listeLaden(art: VorlagenArt) {
	return async ({ locals }: RequestEvent) => {
		const k = await seitenZugriff(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
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
}

/** Aktionen der Liste: neu, Beispiele übernehmen, duplizieren, archivieren, wiederherstellen. */
export function listeAktionen(art: VorlagenArt): Actions {
	return {
		neu: async ({ locals }) => {
			let neu: string;
			try {
				const k = await zugriffVorlagen(locals);
				neu = (await legeVorlageAn(k, art === 'aufmass' ? { name: 'Neues Aufmaß', schema: leeresAufmass(), art } : { name: 'Neue Vorlage', schema: leeresSchema() })).id;
			} catch (e) {
				return alsFormFehler(e);
			}
			redirect(303, formularVorlagenPfad(art, neu));
		},
		beispiele: async ({ locals }) => {
			try {
				return { uebernommen: await uebernimmStartvorlagen(await zugriffVorlagen(locals), beispieleFuer(art).map((s) => s.schluessel)) };
			} catch (e) {
				return alsFormFehler(e);
			}
		},
		duplizieren: async ({ locals, request }) => {
			let neu: string;
			try {
				neu = (await dupliziereVorlage(await zugriffVorlagen(locals), await formId(request))).id;
			} catch (e) {
				return alsFormFehler(e);
			}
			redirect(303, formularVorlagenPfad(art, neu));
		},
		archivieren: async ({ locals, request }) => {
			try {
				await archiviereVorlage(await zugriffVorlagen(locals), await formId(request), true);
			} catch (e) {
				return alsFormFehler(e);
			}
		},
		wiederherstellen: async ({ locals, request }) => {
			try {
				await archiviereVorlage(await zugriffVorlagen(locals), await formId(request), false);
			} catch (e) {
				return alsFormFehler(e);
			}
		}
	};
}

/** Baukasten einer Vorlage. Ältere Versionen leiten auf die aktuelle weiter, eine Vorlage der anderen Art auf ihre Adresse. */
export function detailLaden(art: VorlagenArt) {
	return async ({ locals, params }: RequestEvent) => {
		const k = await seitenZugriff(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
		const vorlage = await alsSeitenFehler(() => holeVorlage(k, params.id));
		if (!vorlage.aktuell) {
			const aktuell = (await listeVorlagen(k, { archivierte: true })).find((v) => v.gruppeId === vorlage.gruppeId);
			if (aktuell) redirect(303, formularVorlagenPfad(vorlage.art, aktuell.id));
		}
		if (vorlage.art !== art) redirect(308, formularVorlagenPfad(vorlage.art, vorlage.id));
		// Aufmaß-Vorlagen (msg 2842): Katalogpositionen für „Menge → Angebot“ (nur Bezeichnung und Einheit, keine Preise)
		const katalog =
			vorlage.art === 'aufmass' && (await hatModul(k.betriebId, 'katalog'))
				? (await listeKatalog(k, { nurAktive: true }, false)).map((p) => ({ id: p.id, bezeichnung: p.bezeichnung, einheit: p.einheit }))
				: null;
		return { vorlage, katalog };
	};
}

/** Aktionen im Seitenkopf der Vorlage: duplizieren, archivieren/wiederherstellen, löschen (mit Rückfrage, msg 3091). */
export function detailAktionen(art: VorlagenArt): Actions {
	return {
		duplizieren: async ({ locals, params }) => {
			let neu: string;
			try {
				neu = (await dupliziereVorlage(await zugriffVorlagen(locals), params.id)).id;
			} catch (e) {
				return alsFormFehler(e);
			}
			redirect(303, formularVorlagenPfad(art, neu));
		},
		archivieren: async ({ locals, params }) => {
			try {
				await archiviereVorlage(await zugriffVorlagen(locals), params.id, true);
			} catch (e) {
				return alsFormFehler(e);
			}
		},
		wiederherstellen: async ({ locals, params }) => {
			try {
				await archiviereVorlage(await zugriffVorlagen(locals), params.id, false);
			} catch (e) {
				return alsFormFehler(e);
			}
		},
		loeschen: async ({ locals, params }) => {
			try {
				await loescheVorlage(await zugriffVorlagen(locals), params.id);
			} catch (e) {
				return alsFormFehler(e, { loeschFehler: true });
			}
			redirect(303, formularVorlagenPfad(art));
		}
	};
}
