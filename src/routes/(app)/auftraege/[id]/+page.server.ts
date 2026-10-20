import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import {
	aendereAuftrag,
	holeAuftrag,
	ladeKundenAuswahl,
	loescheAuftrag,
	pruefeStatus,
	setzeStatus,
	sichtVon,
	uebernimmEinmalKunde,
	zustaendigeAus
} from '$lib/server/auftraege';
import { liesProtokoll } from '$lib/server/protokoll';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { anlagenAuswahl } from '$lib/server/anlagen';
import { verlaufZeile } from '$lib/verlauf';
import { ausTagUndUhrzeit, berlinTag, istTag } from '$lib/zeit';
import { holeKunde } from '$lib/server/kunden';
import { listeKundenNotizen } from '$lib/server/kundenakte';
import { todoAktionen } from '$lib/server/todo-aktionen';
import { aktiveMitarbeiter, listeTodos, todoSichtVon } from '$lib/server/todos';
import { einsaetzeZumAuftrag, legeEinsatzAn } from '$lib/server/plantafel';
import { angeboteZugriff, legeAngebotAn, listeAngebote, ordneAngebotZu } from '$lib/server/angebote';
import { listeAngebotVorlagen } from '$lib/server/angebot-vorlagen';
import { ohnePreise } from '$lib/server/preisschutz';
import { hatModul } from '$lib/server/tarif';
import { entwirfAngebot } from '$lib/server/ki/angebot-entwurf';
import { listeProtokolle, listeVorlagen, protokollVerlauf, starteProtokoll } from '$lib/server/protokoll-formulare';
import { protokollRechte, zugriffAusfuellen } from '$lib/server/protokoll-zugriff';

/**
 * Auftrag mit Statuskette, Einsätzen, To-dos, Angeboten und Verlauf. Nicht sichtbare (fremde/unbekannte) Aufträge: 404.
 * Angebote nur mit Modul `angebote` und Recht `angebote.bearbeiten` (sonst `null`); Beträge nur mit `preise.sehen`,
 * Öffnen/Erstellen (`darfAngebote`) nur mit beiden Rechten.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const sicht = sichtVon(nutzer);
		const auftrag = await holeAuftrag(k, sicht, params.id);
		const darfBearbeiten = hatRecht(nutzer, 'auftraege.bearbeiten');
		const preise = hatRecht(nutzer, 'preise.sehen');
		const angeboteSichtbar = hatRecht(nutzer, 'angebote.bearbeiten') && (await hatModul(k.betriebId, 'angebote'));
		// „+ Termin“ (Einsatz mit Art) im Auftrag: wie auf der Plantafel nur mit `plantafel.bearbeiten`
		const darfTermine = hatRecht(nutzer, 'plantafel.bearbeiten') && (await hatModul(k.betriebId, 'plantafel'));
		// Hinweise zum Kunden (Notiz am Kunden + neueste Kundennotizen) – nur wer Kunden sehen darf
		const kundenLesbar = hatRecht(nutzer, 'kunden.lesen') && (await hatModul(k.betriebId, 'kunden'));
		const [protokoll, todos, mitarbeiter, einsaetze, angebote, kunde, kundenNotizen] = await Promise.all([
			liesProtokoll(k, { tabelle: 'auftraege', datensatz: auftrag.id, vor: null }),
			listeTodos(k, todoSichtVon(nutzer), { auftragId: auftrag.id }),
			darfBearbeiten || darfTermine ? aktiveMitarbeiter(k) : Promise.resolve([]),
			einsaetzeZumAuftrag(k, auftrag.id),
			angeboteSichtbar ? listeAngebote(k, { auftragId: auftrag.id }, { sicht, auftragAendern: darfBearbeiten }) : Promise.resolve(null),
			kundenLesbar && auftrag.kundeId ? holeKunde(k, auftrag.kundeId) : Promise.resolve(null),
			kundenLesbar && auftrag.kundeId ? listeKundenNotizen(k, auftrag.kundeId) : Promise.resolve([])
		]);
		// Protokolle (frei gestaltbare Formulare, Wunsch Jamil msg 2649): Liste, „Protokoll starten“, Einträge im Verlauf
		const pr = await protokollRechte(nutzer);
		const [protokolle, protokollVorlagen, protokollEintraege] = await Promise.all([
			pr.lesen ? listeProtokolle(k, { auftragId: auftrag.id }) : Promise.resolve(null),
			pr.ausfuellen ? listeVorlagen(k) : Promise.resolve([]),
			pr.lesen ? protokollVerlauf(k, auftrag.id) : Promise.resolve([])
		]);
		const verlauf = [
			...protokoll.eintraege.map((e) => ({ iso: e.zeit, zeile: verlaufZeile(e) })),
			...protokollEintraege
		].sort((x, y) => (x.iso < y.iso ? 1 : x.iso > y.iso ? -1 : 0));
		return {
			auftrag,
			protokolle,
			protokollVorlagen: protokollVorlagen.map((v) => ({ id: v.id, name: v.name })),
			darfProtokollStarten: pr.ausfuellen,
			todos,
			mitarbeiter,
			einsaetze,
			heute: berlinTag(new Date()),
			benutzerId: nutzer.id,
			verlauf: verlauf.map((v) => v.zeile),
			verlaufGekuerzt: protokoll.naechsteVor !== null,
			darfBearbeiten,
			darfTermine,
			// Objekte des Kunden für die Auswahl direkt im Auftrag
			objekte: darfBearbeiten && auftrag.kundeId ? (await ladeKundenAuswahl(k, auftrag.kundeId)).objekte : [],
			// Anlagen des Objekts für die Auswahl „Anlage“ (Wunsch Jamil, msg 2505)
			anlagen: darfBearbeiten ? await anlagenAuswahl(k, auftrag.objektId) : [],
			// Einmal-Kunde → Kundendatenbank: Aufträge bearbeiten UND Kunden bearbeiten
			darfKundeUebernehmen:
				auftrag.kundeArt === 'einmal' && darfBearbeiten && hatRecht(nutzer, 'kunden.bearbeiten') && (await hatModul(k.betriebId, 'kunden')),
			kundenHinweise: kunde ? { notiz: kunde.notiz ?? null, notizen: kundenNotizen.slice(0, 3), weitere: Math.max(0, kundenNotizen.length - 3) } : null,
			kundeLesbar: hatRecht(nutzer, 'kunden.lesen'),
			// Preisschutz: Beträge nur mit `preise.sehen`
			angebote: angebote && (preise ? angebote : ohnePreise(angebote)),
			darfAngebote: angeboteSichtbar && preise,
			// „Angebot zuordnen“: noch nicht zugeordnete Angebote dieses Kunden oder ohne Kunden (nur wer sie sehen darf)
			zuordenbareAngebote:
				angeboteSichtbar && preise && darfBearbeiten
					? (await listeAngebote(k, { ohneAuftrag: true }, { sicht, auftragAendern: darfBearbeiten })).filter(
							(an) => an.kundeId === null || an.kundeId === auftrag.kundeId
						)
					: [],
			// Auswahl „Vorlage“ beim „Angebot erstellen“ (Vorlagen enthalten Preise: nur mit beiden Rechten)
			angebotVorlagen: angeboteSichtbar && preise ? await listeAngebotVorlagen(k) : [],
			// „KI-Entwurf“: zusätzlich Modul ki_angebote (Stichworte/Foto → Entwurf nur aus dem Katalog)
			darfKiEntwurf: angeboteSichtbar && preise && (await hatModul(k.betriebId, 'ki_angebote'))
		};
	});
};

const todo = todoAktionen(true);

const text = (f: FormData, feld: string) => {
	const w = f.get(feld);
	return typeof w === 'string' ? w : '';
};

export const actions: Actions = {
	/**
	 * Einzelne Felder direkt im Auftrag ändern (Wunsch Jamil): Objekt, Beschreibung, Titel, Zuständige –
	 * nur die gesendeten Felder; Rechte wie „Auftrag bearbeiten“.
	 */
	aendern: async ({ locals, params, request }) => {
		const f = await request.formData();
		const e: Record<string, unknown> = { ...zustaendigeAus(f) };
		for (const feld of ['objektId', 'anlageId', 'beschreibung', 'titel']) if (f.has(feld)) e[feld] = text(f, feld);
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await aendereAuftrag(betriebKontext(locals), params.id, e, sichtVon(locals.nutzer!));
		} catch (e) {
			const meldung = e instanceof ApiFehler ? e.message : 'Interner Fehler. Bitte später erneut versuchen.';
			return alsFormFehler(e, { aendernFehler: meldung });
		}
		return { gespeichert: true };
	},
	/** Termin (Einsatz) mit Art im Auftrag anlegen: Art, Mitarbeiter, Tag, von, bis, Notiz (`plantafel.bearbeiten`). */
	terminAnlegen: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await darf(locals, 'plantafel', 'plantafel.bearbeiten');
			const k = betriebKontext(locals);
			await holeAuftrag(k, sichtVon(locals.nutzer!), params.id);
			const tag = text(f, 'tag');
			if (!istTag(tag)) throw new ApiFehler(400, 'Bitte einen Tag wählen.');
			let beginn: Date, ende: Date;
			try {
				beginn = ausTagUndUhrzeit(tag, text(f, 'von'));
				ende = ausTagUndUhrzeit(tag, text(f, 'bis'));
			} catch {
				throw new ApiFehler(400, 'Bitte Beginn und Ende als Uhrzeit angeben (z. B. 08:00).');
			}
			await legeEinsatzAn(k, {
				auftragId: params.id,
				benutzerId: text(f, 'benutzerId'),
				beginn: beginn.toISOString(),
				ende: ende.toISOString(),
				notiz: text(f, 'notiz'),
				art: text(f, 'art')
			});
		} catch (e) {
			const meldung = e instanceof ApiFehler ? e.message : 'Interner Fehler. Bitte später erneut versuchen.';
			return alsFormFehler(e, { terminFehler: meldung });
		}
	},
	/** Bestehendes (noch nicht zugeordnetes) Angebot diesem Auftrag zuordnen. */
	angebotZuordnen: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			const zg = await angeboteZugriff(locals);
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await ordneAngebotZu(betriebKontext(locals), text(f, 'angebotId'), { auftragId: params.id }, zg);
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	/** Einmal-Kunden in die Kundendatenbank übernehmen und zum neuen Kunden springen. */
	kundeUebernehmen: async ({ locals, params }) => {
		let kundeId: string | null;
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			kundeId = (await uebernimmEinmalKunde(betriebKontext(locals), params.id, sichtVon(locals.nutzer!))).kundeId;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/kunden/${kundeId}`);
	},
	/** Protokoll aus einer Vorlage starten und den Assistenten öffnen (`protokolle.ausfuellen`). */
	protokollStarten: async ({ locals, params, request }) => {
		const vorlage = (await request.formData()).get('vorlageId');
		let id: string;
		try {
			const { k, sicht } = await zugriffAusfuellen(locals);
			id = (await starteProtokoll(k, sicht, { vorlageId: vorlage, auftragId: params.id })).id;
		} catch (e) {
			const meldung = e instanceof ApiFehler ? e.message : 'Interner Fehler. Bitte später erneut versuchen.';
			return alsFormFehler(e, { protokollFehler: meldung });
		}
		redirect(303, `/protokolle/${id}`);
	},
	todoAnlegen: todo.anlegen,
	todoUmschalten: todo.umschalten,
	todoAendern: todo.aendern,
	todoLoeschen: todo.loeschen,
	todoSerieBeenden: todo.serieBeenden,
	/** Ein Schritt vor oder zurück in der Statuskette (Formularfeld `status` = Zielstatus). */
	status: async ({ locals, params, request }) => {
		const form = await request.formData();
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await setzeStatus(betriebKontext(locals), params.id, pruefeStatus(form.get('status')), sichtVon(locals.nutzer!), {
				sprung: form.get('sprung') === '1'
			});
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/auftraege/${params.id}`);
	},
	/** Neues Angebot (Entwurf) zu diesem Auftrag anlegen und den Editor öffnen. */
	/** Neues Angebot (Entwurf); mit `vorlageId` gleich mit den Positionen und Texten einer Angebots-Vorlage. */
	angebotErstellen: async ({ locals, params, request }) => {
		const vorlage = (await request.formData()).get('vorlageId');
		let id: string;
		try {
			const zg = await angeboteZugriff(locals);
			const vorlageId = typeof vorlage === 'string' && vorlage !== '' ? vorlage : null;
			id = (await legeAngebotAn(betriebKontext(locals), params.id, zg, vorlageId)).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/angebote/${id}`);
	},
	/** KI-Angebotsentwurf aus Stichworten (und optional Foto mit Zustimmung) – nur Katalogpositionen, Preise aus dem Katalog. */
	kiEntwurf: async ({ locals, params, request }) => {
		const form = await request.formData();
		const stichworte = typeof form.get('stichworte') === 'string' ? (form.get('stichworte') as string) : '';
		let id: string;
		try {
			const datei = form.get('foto');
			const foto = datei instanceof File && datei.size > 0 ? new Uint8Array(await datei.arrayBuffer()) : null;
			id = (await entwirfAngebot(locals, params.id, { stichworte, foto, zustimmung: form.get('zustimmung') === 'ja' })).angebotId;
		} catch (e) {
			return alsFormFehler(e, { kiStichworte: stichworte });
		}
		redirect(303, `/angebote/${id}`);
	},
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await loescheAuftrag(betriebKontext(locals), params.id, sichtVon(locals.nutzer!));
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, '/auftraege');
	}
};
