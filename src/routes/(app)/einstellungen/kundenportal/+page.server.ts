import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler } from '$lib/server/seite';
import { agbAusFormular, holeAgbPdfInfo, ladeBestandskunden, ladePortalEinstellungen, ladePortalMarke, loescheAgbPdf, portalEinstellungsZugriff, speichereBestandskunden, speicherePortalEinstellungen, speichereAgbPdf } from '$lib/server/kundenportal';
import { hatModul } from '$lib/server/tarif';

/**
 * Einstellungen → Kundenportal & Auftragsbestätigung (Jamil msg 2778): AGB-/Widerrufs-Link, AGB-PDF (msg 3030), AB automatisch –
 * und seit msg 3534 auch „Leistungen für Bestandskunden“ (früher eigene Seite /einstellungen/bestandskunden, leitet hierher).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) error(401, 'Nicht angemeldet');
	const k = await alsSeitenFehler(() => portalEinstellungsZugriff(locals));
	return alsSeitenFehler(async () => ({
		e: await ladePortalEinstellungen(k),
		agbPdf: await holeAgbPdfInfo(k),
		portalModul: await hatModul(k.betriebId, 'kundenportal'),
		bestand: await ladeBestandskunden(k),
		marke: await ladePortalMarke(k)
	}));
};

export const actions: Actions = {
	// benannte Aktion statt `default`: SvelteKit erlaubt `default` nicht neben benannten Aktionen (agb, bestand)
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = await portalEinstellungsZugriff(locals);
			await speicherePortalEinstellungen(k, { agbUrl: f.get('agbUrl'), widerrufUrl: f.get('widerrufUrl'), abAutomatisch: f.get('abAutomatisch'), standard: f.get('standard'), teamNamen: f.get('teamNamen'), freiGesendet: f.get('freiGesendet'), freiStatus: f.get('freiStatus'), freiTermine: f.get('freiTermine'), freiMitarbeiter: f.get('freiMitarbeiter'), freiAnnahme: f.get('freiAnnahme'), apAusblenden: f.get('apAusblenden') });
			return { gespeichert: true };
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	/** Leistungen für Bestandskunden (msgs 3408, 3534): Karte, Texte, Leistungen, Knöpfe – als JSON im Feld `daten`. */
	bestand: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = await portalEinstellungsZugriff(locals);
			let roh: unknown;
			try {
				const d = f.get('daten');
				roh = JSON.parse(typeof d === 'string' ? d : '');
			} catch {
				throw new ApiFehler(400, 'Die Eingaben konnten nicht gelesen werden. Bitte die Seite neu laden und erneut versuchen.');
			}
			await speichereBestandskunden(k, roh);
			return { bestandGespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { bestandFehler: true });
		}
	},
	// AGB als PDF (msg 3030): hochladen/ersetzen und entfernen
	agb: async ({ locals, request }) => {
		try {
			const k = await portalEinstellungsZugriff(locals);
			let f: FormData;
			try {
				f = await request.formData();
			} catch {
				f = new FormData(); // zu groß oder kaputt: wie „keine Datei“
			}
			await speichereAgbPdf(k, await agbAusFormular(f));
			return { agbGespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { agbFehler: true });
		}
	},
	agbLoeschen: async ({ locals }) => {
		try {
			await loescheAgbPdf(await portalEinstellungsZugriff(locals));
			return { agbGeloescht: true };
		} catch (e) {
			return alsFormFehler(e, { agbFehler: true });
		}
	}
};
