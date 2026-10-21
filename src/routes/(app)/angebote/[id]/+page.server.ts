import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { angeboteZugriff } from '$lib/server/angebote';
import { betriebKontext } from '$lib/server/rechte';
import { markiereGesendet, nachfassenZumAngebot, setzeNachfassenPausiert } from '$lib/server/nachfassen';
import { holeAngebot } from '$lib/server/angebote';
import { listeAngebotVorlagen } from '$lib/server/angebot-vorlagen';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { ladeFirmensatz } from '$lib/server/kalkulation';
import { mailVorbereitung } from '$lib/server/mail-vorlagen';

/** Angebots-Editor. Gespeichert wird über die API (`PATCH`/`PUT …/positionen`, Status, neue Version, PDF). */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	const angebot = await alsSeitenFehler(() =>
		holeAngebot(k, params.id, {
			sicht: sichtVon(locals.nutzer!),
			auftragAendern: hatRecht(locals.nutzer!, 'auftraege.bearbeiten')
		})
	);
	// „+ Aus Vorlage“ gibt es nur im Entwurf
	// Ampel/Gewinn (msg 2476): Stundensätze aus der Kalkulation – keine Gehälter, nur mit „Preise sehen“ (oben geprüft)
	return {
		angebot,
		vorlagen: angebot.status === 'entwurf' ? await listeAngebotVorlagen(k) : [],
		satz: await ladeFirmensatz(k),
		// Automatisches Nachfassen (Jamil msgs 2633/2636): Läufe mit fertigem Mailtext, Pause
		nachfassen: await nachfassenZumAngebot(k, angebot.id),
		// „Mail an Kunden“ zum Angebot (Vorlagen-Bibliothek, msg 2789) – nicht für Entwürfe
		mail: angebot.status !== 'entwurf' ? await mailVorbereitung(k, { angebotId: angebot.id }, ['nachfassen_angebot', 'allgemein'], { preise: true }) : null
	};
};

/** Nachfassen: pausieren/fortsetzen und Mail als gesendet markieren (wie das Angebot: `angebote.bearbeiten`). */
export const actions: Actions = {
	nachfassenPause: async ({ locals, params, request }) => {
		const pausiert = (await request.formData()).get('pausiert') === 'ja';
		try {
			await angeboteZugriff(locals);
			await holeAngebot(betriebKontext(locals), params.id, { sicht: sichtVon(locals.nutzer!), auftragAendern: false });
			await setzeNachfassenPausiert(betriebKontext(locals), params.id, pausiert);
		} catch (e) {
			return alsFormFehler(e, { nachfassenFehler: true });
		}
	},
	nachfassenGesendet: async ({ locals, params, request }) => {
		const laufId = (await request.formData()).get('id');
		try {
			await angeboteZugriff(locals);
			await holeAngebot(betriebKontext(locals), params.id, { sicht: sichtVon(locals.nutzer!), auftragAendern: false });
			await markiereGesendet(betriebKontext(locals), params.id, laufId);
		} catch (e) {
			return alsFormFehler(e, { nachfassenFehler: true });
		}
	}
};
