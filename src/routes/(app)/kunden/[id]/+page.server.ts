import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { holeKunde, listeObjekte, loescheKunde } from '$lib/server/kunden';
import { liesProtokoll } from '$lib/server/protokoll';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf, hatModul } from '$lib/server/tarif';
import { listeAuftraege, sichtVon, type Auftrag } from '$lib/server/auftraege';
import { verlaufZeile } from '$lib/verlauf';
import { kundenVerlauf } from '$lib/server/kunden-verlauf';
import { angeboteZugriff, legeAngebotOhneAuftragAn } from '$lib/server/angebote';
import {
	legeKundenNotizAn,
	listeKundenDateien,
	listeKundenNotizen,
	loescheKundenDatei,
	loescheKundenNotiz,
	speichereKundenDatei
} from '$lib/server/kundenakte';

/**
 * Kunde mit Objekten, Aufträgen und Verlauf (Änderungsprotokoll, neueste zuerst). Fremde Kunden: 404.
 * Aufträge nur mit Modul `auftraege` und Leserecht (`null` = Bereich ausblenden); mit nur `auftraege.lesen` die eigenen.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	const nutzer = locals.nutzer!;
	const auftraegeLesbar =
		(hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen')) &&
		(await hatModul(k.betriebId, 'auftraege'));
	return alsSeitenFehler(async () => {
		const kunde = await holeKunde(k, params.id);
		const [objekte, protokoll, auftraege, notizen, dokumente, zeitleiste] = await Promise.all([
			listeObjekte(k, kunde.id),
			liesProtokoll(k, { tabelle: 'kunden', datensatz: kunde.id, vor: null }),
			auftraegeLesbar ? listeAuftraege(k, sichtVon(nutzer), { kundeId: kunde.id }) : null,
			listeKundenNotizen(k, kunde.id),
			listeKundenDateien(k, kunde.id),
			kundenVerlauf(k, nutzer, kunde.id)
		]);
		return {
			kunde,
			objekte,
			auftraege: auftraege as Auftrag[] | null,
			darfAuftragAnlegen: auftraegeLesbar && hatRecht(nutzer, 'auftraege.bearbeiten'),
			notizen,
			dokumente,
			zeitleiste,
			// „+ Angebot ohne Auftrag“: Angebotsrechte + Preise + alle Aufträge sehen (sonst sähe man es danach nicht)
			darfAngebotAnlegen:
				hatRecht(nutzer, 'angebote.bearbeiten') &&
				hatRecht(nutzer, 'preise.sehen') &&
				hatRecht(nutzer, 'auftraege.alle_lesen') &&
				(await hatModul(k.betriebId, 'angebote')),
			verlauf: protokoll.eintraege.map(verlaufZeile),
			verlaufGekuerzt: protokoll.naechsteVor !== null,
			darfBearbeiten: hatRecht(locals.nutzer!, 'kunden.bearbeiten')
		};
	});
};

const text = (f: FormData, feld: string) => {
	const w = f.get(feld);
	return typeof w === 'string' ? w : '';
};

/** Schreiben in der Kundenakte: Modul `kunden` + `kunden.bearbeiten`; Fehler je Bereich (`notizFehler`, `dokumentFehler`). */
async function akte(locals: App.Locals, bereich: 'notizFehler' | 'dokumentFehler', fn: () => Promise<unknown>) {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		await fn();
	} catch (e) {
		const meldung = e instanceof ApiFehler ? e.message : 'Interner Fehler. Bitte später erneut versuchen.';
		return alsFormFehler(e, { [bereich]: meldung } as Record<string, string>);
	}
}

export const actions: Actions = {
	/** Neues Angebot ohne Auftrag für diesen Kunden → Editor. */
	angebotErstellen: async ({ locals, params }) => {
		let id: string;
		try {
			const zg = await angeboteZugriff(locals);
			id = (await legeAngebotOhneAuftragAn(betriebKontext(locals), params.id, zg)).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/angebote/${id}`);
	},
	notizAnlegen: async ({ locals, params, request }) => {
		const f = await request.formData();
		return akte(locals, 'notizFehler', () => legeKundenNotizAn(betriebKontext(locals), params.id, text(f, 'text')));
	},
	notizLoeschen: async ({ locals, params, request }) => {
		const f = await request.formData();
		return akte(locals, 'notizFehler', () => loescheKundenNotiz(betriebKontext(locals), params.id, text(f, 'id')));
	},
	dokumentHochladen: async ({ locals, params, request }) => {
		const f = await request.formData();
		return akte(locals, 'dokumentFehler', async () => {
			const datei = f.get('datei');
			if (!(datei instanceof File) || datei.size === 0) throw new ApiFehler(400, 'Bitte eine Datei auswählen.');
			await speichereKundenDatei(betriebKontext(locals), params.id, {
				name: datei.name,
				typ: datei.type,
				inhalt: new Uint8Array(await datei.arrayBuffer()),
				beschreibung: text(f, 'beschreibung')
			});
		});
	},
	dokumentLoeschen: async ({ locals, params, request }) => {
		const f = await request.formData();
		return akte(locals, 'dokumentFehler', () => loescheKundenDatei(betriebKontext(locals), params.id, text(f, 'id')));
	},
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await loescheKunde(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, '/kunden');
	}
};
