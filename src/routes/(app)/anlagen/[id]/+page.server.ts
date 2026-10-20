import { fail, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import {
	ANLAGE_FELDER,
	aendereAnlage,
	anlagenVerlauf,
	holeAnlage,
	legeStoerungAn,
	listeAnlagenDateien,
	loescheAnlage,
	loescheAnlagenDatei,
	planeWartung,
	setzeStoerungBehoben,
	speichereAnlagenDatei
} from '$lib/server/anlagen';
import { extraAusFormular } from '$lib/anlagen-typen';
import { sichtVon } from '$lib/server/auftraege';
import { aktiveMitarbeiter, todoSichtVon } from '$lib/server/todos';
import { KUNDEN_DATEI_MAX } from '$lib/server/kundenakte';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

/**
 * Anlage mit Verlauf (Wünsche Jamil, msgs 2503/2505). Lesen und Störung melden: `kunden.lesen` (auch Monteure vor
 * Ort); Ändern, Dateien, Störung beheben, Löschen: `kunden.bearbeiten`; Wartung planen zusätzlich
 * `auftraege.bearbeiten` (legt Aufgaben an).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	const n = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const anlage = await holeAnlage(k, params.id);
		const qrUrl = `${url.origin}/a/${anlage.qrToken}`;
		const darfBearbeiten = hatRecht(n, 'kunden.bearbeiten');
		const darfAuftraege = hatRecht(n, 'auftraege.bearbeiten');
		return {
			anlage,
			qrUrl,
			qrBild: await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 256 }),
			verlauf: await anlagenVerlauf(k, anlage.id, sichtVon(n), todoSichtVon(n)),
			dateien: await listeAnlagenDateien(k, anlage.id),
			darfBearbeiten,
			darfWartung: darfBearbeiten && darfAuftraege,
			darfAuftrag: darfAuftraege,
			mitarbeiter: darfBearbeiten && darfAuftraege ? await aktiveMitarbeiter(k) : []
		};
	});
};

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const f = await request.formData();
		const werte = formWerte(f, ANLAGE_FELDER);
		const extra = extraAusFormular(f);
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await aendereAnlage(betriebKontext(locals), params.id, werte, extra);
		} catch (e) {
			return alsFormFehler(e, {
				aktion: 'speichern',
				werte: { ...werte, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`extra_${k}`, v])) }
			});
		}
		return { aktion: 'speichern', gespeichert: true };
	},
	stoerung: async ({ locals, params, request }) => {
		const f = await request.formData();
		const titel = f.get('titel');
		const beschreibung = f.get('beschreibung');
		try {
			await darf(locals, 'kunden', 'kunden.lesen');
			await legeStoerungAn(betriebKontext(locals), params.id, { titel, beschreibung });
		} catch (e) {
			return alsFormFehler(e, { aktion: 'stoerung', titel: String(titel ?? ''), beschreibung: String(beschreibung ?? '') });
		}
		return { aktion: 'stoerung', gespeichert: true };
	},
	stoerungBehoben: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await setzeStoerungBehoben(betriebKontext(locals), params.id, f.get('id'), f.get('behoben') === 'ja');
		} catch (e) {
			return alsFormFehler(e, { aktion: 'stoerungBehoben' });
		}
	},
	wartung: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await planeWartung(betriebKontext(locals), params.id, { faellig: f.get('faellig'), zustaendigId: f.get('zustaendigId') });
		} catch (e) {
			return alsFormFehler(e, { aktion: 'wartung' });
		}
		return { aktion: 'wartung', gespeichert: true };
	},
	datei: async ({ locals, params, request }) => {
		const f = await request.formData();
		const datei = f.get('datei');
		if (!(datei instanceof File) || datei.size === 0) return fail(400, { aktion: 'datei', fehler: 'Bitte eine Datei wählen.' });
		if (datei.size > KUNDEN_DATEI_MAX) return fail(413, { aktion: 'datei', fehler: 'Die Datei ist zu groß (höchstens 5 MB).' });
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await speichereAnlagenDatei(betriebKontext(locals), params.id, {
				name: datei.name,
				typ: datei.type,
				inhalt: new Uint8Array(await datei.arrayBuffer()),
				beschreibung: f.get('beschreibung')
			});
		} catch (e) {
			return alsFormFehler(e, { aktion: 'datei' });
		}
		return { aktion: 'datei', gespeichert: true };
	},
	dateiLoeschen: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await loescheAnlagenDatei(betriebKontext(locals), params.id, f.get('id'));
		} catch (e) {
			return alsFormFehler(e, { aktion: 'dateiLoeschen' });
		}
	},
	loeschen: async ({ locals, params }) => {
		let ziel: { kundeId: string; objektId: string };
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			ziel = await loescheAnlage(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e, { aktion: 'loeschen' });
		}
		redirect(303, `/kunden/${ziel.kundeId}/objekte/${ziel.objektId}`);
	}
};
