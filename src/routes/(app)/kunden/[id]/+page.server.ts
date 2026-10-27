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
import { kundeKeinNachfassen, setzeKundeKeinNachfassen } from '$lib/server/nachfassen';
import { erzeugeLink, kundenPortal, portalPasswort, portalZugriff, speichereKundenPortal, widerrufeLink } from '$lib/server/kundenportal';
import { mailVorbereitung } from '$lib/server/mail-vorlagen';

export const load: PageServerLoad = async ({ locals, params, url }) => {
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
		// Kundenportal (msg 2793): ein Link je Kunde – Modul kundenportal + Recht kundenportal.verwalten
		const portalErlaubt = hatRecht(nutzer, 'kundenportal.verwalten') && hatRecht(nutzer, 'auftraege.alle_lesen') && (await hatModul(k.betriebId, 'kundenportal'));
		const portalRoh = portalErlaubt ? await kundenPortal(await portalZugriff(locals), kunde.id) : null;
		// Aktiven Link wieder öffnen/kopieren (msg 3036): volle Adresse statt Token
		const basis = (process.env.ORIGIN ?? url?.origin ?? '').replace(/\/$/, '');
		const portal = portalRoh && {
			...portalRoh,
			links: portalRoh.links.map(({ token, ...l }) => ({ ...l, url: token ? `${basis}/portal/${token}` : null }))
		};
		// „Mail an Kunden“ und Portal-Link per Mail (Vorlagen-Bibliothek, msg 2789): wer Kunden oder Aufträge bearbeitet
		const darfMail = hatRecht(nutzer, 'kunden.bearbeiten') || hatRecht(nutzer, 'auftraege.bearbeiten');
		const preise = hatRecht(nutzer, 'preise.sehen');
		const [mail, portalMail] = await Promise.all([
			darfMail ? mailVorbereitung(k, { kundeId: kunde.id }, ['allgemein', 'bewertung'], { preise }) : null,
			portal ? mailVorbereitung(k, { kundeId: kunde.id }, ['portal_link', 'allgemein'], { preise }) : null
		]);
		return {
			mail,
			portalMail,
			kunde,
			portal,
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
			darfBearbeiten: hatRecht(locals.nutzer!, 'kunden.bearbeiten'),
			// Automatisches Nachfassen abschaltbar je Kunde (Jamil msg 2585)
			nachfassen: (await hatModul(k.betriebId, 'angebote')) ? { aus: await kundeKeinNachfassen(k, kunde.id) } : null
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
	/** Kundenportal: neuen Link für den Kunden (ersetzt einen älteren); Token nur jetzt sichtbar. */
	portalLink: async ({ locals, params, request, url }) => {
		const f = await request.formData();
		try {
			const r = await erzeugeLink(await portalZugriff(locals), params.id, f.get('laeuftAb'));
			const basis = (process.env.ORIGIN ?? url.origin).replace(/\/$/, '');
			return { portalUrl: `${basis}/portal/${r.token}` };
		} catch (e) {
			return alsFormFehler(e, { portalFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	},
	/** Portal-Passwort (msg 3037): eigenes setzen oder auf die PLZ zurücksetzen – Rechte wie der Portal-Link. */
	portalPasswort: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			const zuruecksetzen = f.get('aktion') === 'plz';
			const pw = f.get('passwort');
			await portalPasswort(await portalZugriff(locals), params.id, zuruecksetzen ? null : typeof pw === 'string' ? pw : '');
			return {
				portalMeldung: zuruecksetzen
					? 'Passwort zurückgesetzt – der Kunde meldet sich wieder mit seiner Postleitzahl an.'
					: 'Eigenes Passwort gespeichert – bitte dem Kunden mitteilen. Bisherige Anmeldungen im Portal sind damit beendet.'
			};
		} catch (e) {
			return alsFormFehler(e, { portalFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	},
	/** Portal-Einstellungen dieses Kunden (Jamil msgs 3423, 3439): leer = wie in den Einstellungen der Firma. */
	portalEinstellung: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await speichereKundenPortal(await portalZugriff(locals), params.id, {
				sichtbar: f.get('sichtbar'),
				status: f.get('status'),
				termine: f.get('termine'),
				mitarbeiter: f.get('mitarbeiter'),
				annahme: f.get('annahme'),
				abAutomatisch: f.get('abAutomatisch')
			});
			return { portalMeldung: 'Portal-Einstellungen des Kunden gespeichert.' };
		} catch (e) {
			return alsFormFehler(e, { portalFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	},
	portalWiderrufen: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await widerrufeLink(await portalZugriff(locals), params.id, f.get('linkId'));
			return { portalMeldung: 'Link widerrufen – er funktioniert ab sofort nicht mehr.' };
		} catch (e) {
			return alsFormFehler(e, { portalFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	},
	/** „Kein automatisches Nachfassen“ für diesen Kunden an/aus (`kunden.bearbeiten`). */
	nachfassen: async ({ locals, params, request }) => {
		const aus = (await request.formData()).get('aus') === 'ja';
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await setzeKundeKeinNachfassen(betriebKontext(locals), params.id, aus);
		} catch (e) {
			return alsFormFehler(e);
		}
	},
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
			return alsFormFehler(e, { loeschFehler: true });
		}
		redirect(303, '/kunden');
	}
};
