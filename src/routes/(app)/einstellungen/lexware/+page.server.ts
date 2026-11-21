import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { pruefeModul } from '$lib/server/tarif';
import { mitBetrieb } from '$lib/server/db';
import { geheimnisBereit } from '$lib/server/geheimnis';
import { UUID } from '$lib/server/kunden';
import { pruefeVerbindung, setzeBelegeInLexware, setzeKundenAnlegen, speichereLexwareSchluessel, trenneLexware } from '$lib/server/lexware/konfig';
import { auftragAbbrechen, auftragErneut, listeAuftraege } from '$lib/server/lexware/warteschlange';
import { starteAboEinrichtung, starteAbgleich } from '$lib/server/lexware/abgleich';
import { HANDLER, laufFuerBetrieb } from '$lib/server/lexware/dienst';
import { lexwareStatus } from '$lib/server/lexware/status';

/** Einstellungen → Lexware verbinden (Recht „Einstellungen“, Modul „lexware“; Plan Phase 1). */
async function zugriff(locals: App.Locals) {
	pruefeRecht(locals, 'einstellungen');
	await pruefeModul(locals, 'lexware');
	return betriebKontext(locals);
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	const k = await zugriff(locals);
	const [status, auftraege, protokoll] = await Promise.all([
		lexwareStatus(k),
		listeAuftraege(k, true),
		mitBetrieb(k, (tx) => tx`select methode, pfad, status, dauer_ms, fehler, zeit from app.lexware_protokoll where betrieb_id = ${k.betriebId} order by zeit desc limit 30`)
	]);
	return {
		status,
		auftraege,
		protokoll: protokoll.map((p) => ({ methode: p.methode, pfad: p.pfad.split('?')[0], status: p.status, dauerMs: p.dauer_ms, fehler: p.fehler, zeit: new Date(p.zeit).toISOString() })),
		geheimnisBereit: geheimnisBereit()
	};
};

const feld = (f: FormData, n: string) => {
	const w = f.get(n);
	return typeof w === 'string' ? w : '';
};
const id = (f: FormData) => {
	const w = feld(f, 'id');
	if (!UUID.test(w)) throw new ApiFehler(400, 'Ungültiger Auftrag.');
	return w;
};

export const actions: Actions = {
	schluessel: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = await zugriff(locals);
			const c = await speichereLexwareSchluessel(k, feld(f, 'schluessel'), feld(f, 'gueltigBis'));
			return { aktion: 'schluessel', ergebnis: c.status };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'schluessel' });
		}
	},
	pruefen: async ({ locals }) => {
		try {
			const c = await pruefeVerbindung(await zugriff(locals));
			return { aktion: 'pruefen', ergebnis: c.status };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'pruefen' });
		}
	},
	trennen: async ({ locals }) => {
		try {
			await trenneLexware(await zugriff(locals));
			return { aktion: 'trennen', ergebnis: 'getrennt' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'trennen' });
		}
	},
	abos: async ({ locals }) => {
		try {
			await starteAboEinrichtung(await zugriff(locals));
			return { aktion: 'abos', ergebnis: 'eingestellt' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'abos' });
		}
	},
	abgleich: async ({ locals }) => {
		try {
			await starteAbgleich(await zugriff(locals));
			return { aktion: 'abgleich', ergebnis: 'eingestellt' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'abgleich' });
		}
	},
	kundenAnlegen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await setzeKundenAnlegen(await zugriff(locals), f.get('an') === 'on');
			return { aktion: 'kundenAnlegen', ergebnis: 'gespeichert' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'kundenAnlegen' });
		}
	},
	belege: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await setzeBelegeInLexware(await zugriff(locals), f.get('an') === 'on');
			return { aktion: 'belege', ergebnis: 'gespeichert' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'belege' });
		}
	},
	jetzt: async ({ locals }) => {
		try {
			const r = await laufFuerBetrieb(await zugriff(locals));
			return { aktion: 'jetzt', ergebnis: `${r.erledigt} erledigt${r.fehler ? `, ${r.fehler} mit Fehler` : ''}` };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'jetzt' });
		}
	},
	erneut: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await auftragErneut(await zugriff(locals), id(f));
			return { aktion: 'erneut', ergebnis: 'eingestellt' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'erneut' });
		}
	},
	abbrechen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await auftragAbbrechen(await zugriff(locals), id(f), HANDLER);
			return { aktion: 'abbrechen', ergebnis: 'abgebrochen' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'abbrechen' });
		}
	}
};
