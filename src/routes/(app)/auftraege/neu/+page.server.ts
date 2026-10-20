import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { AUFTRAG_FORM_FELDER, ladeKundenAuswahl, legeAuftragAn, zustaendigeAus } from '$lib/server/auftraege';
import { listeVorlagen } from '$lib/server/auftrag-vorlagen';
import { aktiveMitarbeiter, legeTodosAn, pruefeTodoListe, todosAusFormular } from '$lib/server/todos';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { formWerte, seitenZugriff, vorbelegung } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { holeAnlage } from '$lib/server/anlagen';
import { listeQuellen } from '$lib/server/quellen';
import { ApiFehler } from '$lib/server/fehler';

/** Neuer Auftrag; mit `?kunde=<id>` (Link vom Kunden) ist der Kunde samt seinen Objekten schon gewählt. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'auftraege.bearbeiten');
	const vorlagen = await listeVorlagen(k);
	// Von einer Anlage aus („+ Auftrag zu dieser Anlage“): Kunde, Objekt und Anlage vorbelegt
	const anlageId = url.searchParams.get('anlageId');
	const anlage =
		anlageId && hatRecht(locals.nutzer!, 'kunden.lesen') ? await holeAnlage(k, anlageId).catch(() => null) : null;
	return {
		anlage: anlage && anlage.kundeId === url.searchParams.get('kunde')
			? { id: anlage.id, bezeichnung: anlage.bezeichnung, typName: anlage.typName, objektId: anlage.objektId }
			: null,
		...(await ladeKundenAuswahl(k, url.searchParams.get('kunde'))),
		kundenSuche: hatRecht(locals.nutzer!, 'kunden.lesen'),
		vorlagen,
		mitarbeiter: await aktiveMitarbeiter(k),
		quellen: (await listeQuellen(k, true)).map((q) => ({ id: q.id, name: q.name, aktiv: q.aktiv })),
		// Titel/Start/Beschreibung vorbelegt (z. B. „Ändern“ auf der Bestätigungskarte der Sprachsteuerung)
		vorbelegt: vorbelegung(url, ['titel', 'geplantAb', 'beschreibung', 'objektId'])
	};
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const formData = await request.formData();
		const werte = formWerte(formData, AUFTRAG_FORM_FELDER);

		let id: string;
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			// Quelle ist bei neuen Aufträgen Pflicht (msg 2593), sobald der Betrieb Quellen hat
			if (!werte.quelleId && (await listeQuellen(betriebKontext(locals), true)).length > 0) {
				throw new ApiFehler(400, 'Bitte eine Auftragsquelle wählen (woher kam der Auftrag?).');
			}
			// Aufgaben (z. B. aus einer Vorlage) zuerst prüfen – ein ungültige Aufgabe soll keinen halben Auftrag hinterlassen
			const todos = pruefeTodoListe(todosAusFormular(formData));
			const anlageId = formData.get('anlageId');
			const erg = await legeAuftragAn(betriebKontext(locals), {
				...werte,
				...zustaendigeAus(formData),
				...(typeof anlageId === 'string' && anlageId !== '' ? { anlageId } : {})
			});
			id = erg.id;
			await legeTodosAn(betriebKontext(locals), id, todos);
		} catch (e) {
			// Kunde/Objekte für das erneut angezeigte Formular – nur für Berechtigte (verrät sonst Kundendaten)
			const auswahl =
				locals.nutzer?.betriebId && hatRecht(locals.nutzer, 'auftraege.bearbeiten')
					? await ladeKundenAuswahl(betriebKontext(locals), werte.kundeId).catch(() => null)
					: null;
			return alsFormFehler(e, { werte, auswahl, zustaendige: formData.getAll('zustaendige').map(String) });
		}
		redirect(303, `/auftraege/${id}`);
	}
};
