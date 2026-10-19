import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { zugriffEintrag } from '$lib/server/dokumentation-zugriff';
import { kundeNameAus } from '$lib/server/auftraege';
import { berlinTag } from '$lib/zeit';
import { liesProtokoll } from '$lib/server/baustellen-protokolle';
import { protokollPdf } from '$lib/server/pdf/protokoll-pdf';
import { holeProfil, holeLogo } from '$lib/server/betriebsprofil';

/**
 * PDF: `GET /api/protokolle/[id]/pdf` – erzeugt das Protokoll-PDF und gibt es zurück.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { k } = await zugriffEintrag(locals, params.id, 'protokolle', false);
		const prot = await liesProtokoll(k, params.id);
		if (!prot) return new Response('Nicht gefunden', { status: 404 });
		const profil = await holeProfil(k);
		const logo = await holeLogo(k);
		// Auftragsdaten für das PDF laden
		const { mitBetrieb } = await import('$lib/server/db');
		const [auftrag] = await mitBetrieb(k, (tx) => tx`
			select a.nummer as "auftragNummer", a.titel as "auftragTitel",
				k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname, a.einmal_name, a.einmal_email, o.bezeichnung as "objektBezeichnung"
			from app.auftraege a
			left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
			left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
			where a.id = ${prot.auftragId}`);
		if (auftrag) auftrag.kundeName = kundeNameAus(auftrag);
		if (!auftrag) return new Response('Auftrag nicht gefunden', { status: 404 });
		const inhalt = typeof prot.inhalt === 'string' ? JSON.parse(prot.inhalt) : prot.inhalt;
		// Unterschrift laden (bytea)
		const [{ unterschrift } = { unterschrift: null }] = await mitBetrieb(k, (tx) => tx`
			select unterschrift from app.baustellen_protokolle where id = ${params.id}`);
		const pdf = await protokollPdf({
			profil,
			logo,
			protokoll: {
				nummer: prot.id.slice(0, 8).toUpperCase(),
				typ: prot.typ,
				datum: berlinTag(new Date(prot.angelegt)),
				auftragNummer: auftrag.auftragNummer,
				auftragTitel: auftrag.auftragTitel,
				kundeName: auftrag.kundeName,
				objektBezeichnung: auftrag.objektBezeichnung,
				inhalt
			},
			unterschrift: unterschrift ? Buffer.from(unterschrift) : null
		});
		return new Response(Buffer.from(pdf), {
			headers: {
				'content-type': 'application/pdf',
				'content-disposition': `inline; filename="protokoll-${params.id.slice(0, 8)}.pdf"`,
				'content-length': String(pdf.length)
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};