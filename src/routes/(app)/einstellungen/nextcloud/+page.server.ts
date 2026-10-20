import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { nextcloud } from '$lib/server/nextcloud/konfig';
import { anbindungsBetrieb, listeVerknuepfungen, loeseVerknuepfung, verknuepfe } from '$lib/server/nextcloud/konten';
import { jetztAbgleichen, letzterAbgleich } from '$lib/server/nextcloud/abgleich';
import { UUID } from '$lib/server/kunden';

/** Nextcloud-Anbindung: Konten verknüpfen (Recht „Benutzer verwalten“), Status und „Jetzt abgleichen“. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'benutzer.verwalten') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const nc = nextcloud();
	if (!nc) error(404, 'Nicht gefunden');
	const k = betriebKontext(locals);
	const zustaendig = (await anbindungsBetrieb(nc)) === k.betriebId;
	return {
		zustaendig,
		url: nc.url,
		teile: {
			anmeldung: !!nc.anmeldung,
			zweiFaktorVertrauen: nc.anmeldung?.zweiFaktorVertrauen ?? false,
			perEmail: nc.anmeldung?.perEmail ?? false,
			kalender: nc.kalender,
			kontakte: !!nc.kontakte,
			kontakteGruppe: nc.kontakte?.gruppe ?? null,
			dateien: !!nc.dateien,
			ordner: nc.dateien?.ordner ?? null,
			talk: nc.talk,
			technik: nc.technik?.benutzer ?? null
		},
		konten: zustaendig ? await listeVerknuepfungen(k) : [],
		letzter: letzterAbgleich(),
		darfAbgleichen: hatRecht(locals.nutzer, 'einstellungen')
	};
};

const text = (form: FormData, name: string) => {
	const w = form.get(name);
	return typeof w === 'string' ? w : '';
};
const pruefeId = (id: string) => {
	if (!UUID.test(id)) throw new ApiFehler(400, 'Ungültiger Benutzer.');
	return id;
};

export const actions: Actions = {
	verknuepfen: async ({ locals, request }) => {
		const form = await request.formData();
		const id = text(form, 'id');
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			await verknuepfe(betriebKontext(locals), pruefeId(id), text(form, 'ncBenutzer'));
			return { aktion: 'verknuepfen', id, gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'verknuepfen', id });
		}
	},
	loesen: async ({ locals, request }) => {
		const form = await request.formData();
		const id = text(form, 'id');
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			await loeseVerknuepfung(betriebKontext(locals), pruefeId(id));
			return { aktion: 'loesen', id, gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'loesen', id });
		}
	},
	abgleichen: async ({ locals }) => {
		try {
			pruefeRecht(locals, 'einstellungen');
			const nc = nextcloud();
			if (!nc || (await anbindungsBetrieb(nc)) !== betriebKontext(locals).betriebId) throw new ApiFehler(403, 'Keine Berechtigung');
			const ergebnis = await jetztAbgleichen();
			return { aktion: 'abgleichen', laeuftSchon: ergebnis === null };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'abgleichen' });
		}
	}
};
