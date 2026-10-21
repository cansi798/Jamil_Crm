import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { hatRecht } from '$lib/server/rechte';
import { ohnePreise } from '$lib/server/preisschutz';
import { sichtVon } from '$lib/server/auftraege';
import {
	aenderePartner,
	holePartner,
	loescheKontakt,
	loescheNachweis,
	loeschePartner,
	partnerAuftraege,
	partnerAuswertung,
	partnerZugriff,
	speichereKontakt,
	speichereNachweis
} from '$lib/server/partner';

/** Partner im Detail (Jamil msg 2856): Stammdaten, Konditionen, Ansprechpartner, Nachweise, Aufträge, Auswertung. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'partner.verwalten');
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const partner = await holePartner(k, params.id);
		const preise = hatRecht(nutzer, 'preise.sehen');
		const [auswertung, auftraege] = await Promise.all([partnerAuswertung(k, partner.id, preise), partnerAuftraege(k, sichtVon(nutzer), partner.id)]);
		// Preisschutz: ohne „Preise sehen“ fehlen Umsatz, Provision und Fremdleistungen ganz
		return { partner, auswertung: preise ? auswertung : ohnePreise(auswertung), auftraege };
	});
};

const werte = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;
const meldung = (e: unknown) => (e instanceof ApiFehler ? e.message : 'Interner Fehler.');

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const e = werte(await request.formData());
		try {
			await aenderePartner(await partnerZugriff(locals), params.id, { ...e, aktiv: e.aktiv === 'on' });
			return { bereich: 'stamm', ok: 'Gespeichert.' };
		} catch (f) {
			return alsFormFehler(f, { bereich: 'stamm', fehler: meldung(f), werte: e });
		}
	},
	kontakt: async ({ locals, params, request }) => {
		const e = werte(await request.formData());
		try {
			await speichereKontakt(await partnerZugriff(locals), params.id, e.kontaktId || null, e);
		} catch (f) {
			return alsFormFehler(f, { bereich: 'kontakt', fehler: meldung(f) });
		}
	},
	kontaktLoeschen: async ({ locals, params, request }) => {
		const e = werte(await request.formData());
		try {
			await loescheKontakt(await partnerZugriff(locals), params.id, e.kontaktId);
		} catch (f) {
			return alsFormFehler(f, { bereich: 'kontakt', fehler: meldung(f) });
		}
	},
	nachweis: async ({ locals, params, request }) => {
		const f = await request.formData();
		const datei = f.get('datei');
		try {
			const inhalt = datei instanceof File && datei.size > 0 ? new Uint8Array(await datei.arrayBuffer()) : null;
			await speichereNachweis(await partnerZugriff(locals), params.id, f.get('nachweisId') || null, {
				art: f.get('art'),
				bezeichnung: f.get('bezeichnung'),
				gueltigBis: f.get('gueltigBis'),
				datei: inhalt && datei instanceof File ? { name: datei.name, inhalt } : null
			});
			return { bereich: 'nachweis', ok: 'Nachweis gespeichert.' };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'nachweis', fehler: meldung(e) });
		}
	},
	nachweisLoeschen: async ({ locals, params, request }) => {
		const e = werte(await request.formData());
		try {
			await loescheNachweis(await partnerZugriff(locals), params.id, e.nachweisId);
		} catch (f) {
			return alsFormFehler(f, { bereich: 'nachweis', fehler: meldung(f) });
		}
	},
	loeschen: async ({ locals, params }) => {
		let erg: string;
		try {
			erg = await loeschePartner(await partnerZugriff(locals), params.id);
		} catch (f) {
			return alsFormFehler(f, { bereich: 'loeschen', fehler: meldung(f) });
		}
		if (erg === 'geloescht') redirect(303, '/partner');
		return { bereich: 'loeschen', ok: 'Der Partner hängt an Aufträgen und wurde deshalb nur deaktiviert.' };
	}
};
