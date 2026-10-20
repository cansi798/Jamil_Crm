import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { listeQuellen } from '$lib/server/quellen';
import {
	aendereDienst,
	aendereLink,
	buchungZugriff,
	holeDienst,
	holeEinstellungen,
	kommendeBuchungen,
	legeMitarbeiterLinkAn,
	loescheDienst,
	loescheLink,
	mitarbeiterAus
} from '$lib/server/buchung';

/** Ein Dienst der Online-Buchung: Angaben, Mitarbeiter, Fragen, Buchungslinks mit Einbett-Code. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	await alsSeitenFehler(() => buchungZugriff(locals));
	const k = betriebKontext(locals);
	const dienst = await alsSeitenFehler(() => holeDienst(k, params.id));
	const [mitarbeiter, quellen, einstellungen, buchungen] = await Promise.all([
		aktiveMitarbeiter(k),
		listeQuellen(k, true),
		holeEinstellungen(k),
		kommendeBuchungen(k, dienst.id, 20)
	]);
	return {
		dienst,
		mitarbeiter,
		quellen: quellen.map((q) => ({ id: q.id, name: q.name })),
		einstellungen,
		buchungen,
		// öffentliche Adresse der Anwendung (für Links und Einbett-Code)
		basis: process.env.ORIGIN?.replace(/\/$/, '') || url.origin
	};
};

const FELDER = ['name', 'beschreibung', 'dauerMin', 'pufferVorMin', 'pufferNachMin', 'vorlaufMin', 'horizontTage', 'maxProTag', 'ortArt', 'farbe', 'modus', 'einsatzArt', 'adresse', 'fragen', 'quelleId'] as const;

async function mit(locals: App.Locals, bereich: string, fn: () => Promise<unknown>) {
	try {
		await buchungZugriff(locals);
		const ergebnis = await fn();
		return { bereich, ergebnis: typeof ergebnis === 'string' ? ergebnis : 'ok' };
	} catch (e) {
		return alsFormFehler(e, { bereich });
	}
}

export const actions: Actions = {
	speichern: async ({ locals, request, params }) => {
		const f = await request.formData();
		const e: Record<string, unknown> = {};
		for (const feld of FELDER) {
			const w = f.get(feld);
			if (typeof w === 'string') e[feld] = w;
		}
		e.aktiv = f.get('aktiv') === 'on' || f.get('aktiv') === 'true';
		return mit(locals, 'dienst', () => aendereDienst(betriebKontext(locals), params.id, e, mitarbeiterAus(f)));
	},
	linkAnlegen: async ({ locals, request, params }) => {
		const f = await request.formData();
		return mit(locals, 'links', () => legeMitarbeiterLinkAn(betriebKontext(locals), params.id, f.get('benutzerId')));
	},
	linkAendern: async ({ locals, request }) => {
		const f = await request.formData();
		return mit(locals, 'links', () =>
			aendereLink(betriebKontext(locals), f.get('id'), { quelleId: f.get('quelleId') ?? undefined, aktiv: f.has('aktivGesendet') ? f.get('aktiv') === 'on' : undefined })
		);
	},
	linkNeu: async ({ locals, request }) => {
		const f = await request.formData();
		return mit(locals, 'links', () => aendereLink(betriebKontext(locals), f.get('id'), { neuesToken: true }));
	},
	linkLoeschen: async ({ locals, request }) => {
		const f = await request.formData();
		return mit(locals, 'links', () => loescheLink(betriebKontext(locals), f.get('id')));
	},
	loeschen: async ({ locals, params }) => {
		let ergebnis: string;
		try {
			await buchungZugriff(locals);
			ergebnis = await loescheDienst(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e, { bereich: 'loeschen' });
		}
		if (ergebnis === 'geloescht') redirect(303, '/einstellungen/online-buchung');
		return { bereich: 'loeschen', ergebnis };
	}
};
