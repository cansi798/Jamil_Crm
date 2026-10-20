import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler } from '$lib/server/seite';
import { aufmassZugriff, ladeSchaetzung, listeSchaetzungen, schaetze, uebernimm, verwirf } from '$lib/server/foto-aufmass';
import { holeAuftrag } from '$lib/server/auftraege';
import { MENGEN_SCHLUESSEL, OBJEKTE } from '$lib/foto-aufmass';

/**
 * Foto-Aufmaß (Jamil msgs 2770–2774 Punkt 8, 2780): bekannte Flächen + Fakten eingeben, Fotos dazu, KI schätzt den Rest;
 * Entwurf prüfen, korrigieren, als Angebotsentwurf übernehmen. Rechte wie beim KI-Angebotsentwurf.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	return alsSeitenFehler(async () => {
		const { k, zg } = await aufmassZugriff(locals);
		const auftrag = await holeAuftrag(k, zg.sicht, params.id);
		const id = url.searchParams.get('schaetzung');
		return {
			auftrag: { id: auftrag.id, nummer: auftrag.nummer, titel: auftrag.titel },
			schaetzung: id ? await ladeSchaetzung(k, zg.sicht, id, auftrag.id) : null,
			fruehere: await listeSchaetzungen(k, zg.sicht, auftrag.id)
		};
	});
};

const text = (f: FormData, n: string) => (typeof f.get(n) === 'string' ? (f.get(n) as string) : '');

export const actions: Actions = {
	schaetzen: async ({ locals, params, request }) => {
		const f = await request.formData();
		const werte: Record<string, unknown> = { raumart: text(f, 'raumart'), wandM2: text(f, 'wandM2'), bodenM2: text(f, 'bodenM2'), hoeheM: text(f, 'hoeheM'), referenz: text(f, 'referenz') };
		for (const o of OBJEKTE) werte[o] = text(f, o);
		let id: string;
		try {
			const fotos: Uint8Array[] = [];
			for (const d of f.getAll('fotos')) if (d instanceof File && d.size > 0) fotos.push(new Uint8Array(await d.arrayBuffer()));
			id = await schaetze(locals, params.id, werte, fotos, f.get('zustimmung') === 'ja');
		} catch (e) {
			return alsFormFehler(e, { schaetzFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.', werte: werte as Record<string, string> });
		}
		redirect(303, `/auftraege/${params.id}/foto-aufmass?schaetzung=${id}`);
	},
	uebernehmen: async ({ locals, params, request }) => {
		const f = await request.formData();
		let angebotId: string | null;
		try {
			const mengen: Record<string, unknown> = {};
			for (const m of MENGEN_SCHLUESSEL) mengen[m] = text(f, `m_${m}`);
			const positionen = f.getAll('pos').map((p) => String(p)).map((pid) => ({ katalogPositionId: pid, menge: text(f, `menge_${pid}`), nehmen: f.get(`nehmen_${pid}`) === 'ja' }));
			angebotId = await uebernimm(locals, params.id, text(f, 'id'), { mengen, positionen });
		} catch (e) {
			return alsFormFehler(e, { uebernehmenFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
		redirect(303, angebotId ? `/angebote/${angebotId}` : `/auftraege/${params.id}`);
	},
	verwerfen: async ({ locals, params, request }) => {
		try {
			await verwirf(locals, params.id, (await request.formData()).get('id'));
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/auftraege/${params.id}/foto-aufmass`);
	}
};
