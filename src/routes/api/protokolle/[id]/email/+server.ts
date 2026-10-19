import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { zugriffEintrag } from '$lib/server/dokumentation-zugriff';
import { kundeNameAus } from '$lib/server/auftraege';
import { berlinTag } from '$lib/zeit';
import { liesProtokoll } from '$lib/server/baustellen-protokolle';
import { sendeProtokollEmail } from '$lib/server/email';
import { holeProfil, holeLogo } from '$lib/server/betriebsprofil';

/**
 * E-Mail: `POST /api/protokolle/[id]/email` – sendet das Protokoll-PDF per E-Mail an den Kunden.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	try {
		const { k } = await zugriffEintrag(locals, params.id, 'protokolle', true);
		const prot = await liesProtokoll(k, params.id);
		if (!prot) return json({ fehler: 'Nicht gefunden' }, { status: 404 });
		const profil = await holeProfil(k);
		const logo = await holeLogo(k);
		const { mitBetrieb } = await import('$lib/server/db');
		const [auftrag] = await mitBetrieb(k, (tx) => tx`
			select a.nummer as "auftragNummer", a.titel as "auftragTitel",
				k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname, a.einmal_name, a.einmal_email, k.email as "kundeEmail",
				o.bezeichnung as "objektBezeichnung"
			from app.auftraege a
			left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
			left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
			where a.id = ${prot.auftragId}`);
		if (auftrag) auftrag.kundeName = kundeNameAus(auftrag);
		if (!auftrag) return json({ fehler: 'Auftrag nicht gefunden' }, { status: 404 });
		auftrag.kundeEmail = auftrag.kundeEmail ?? auftrag.einmal_email;
		if (!auftrag.kundeEmail) return json({ fehler: 'Kunde hat keine E-Mail-Adresse' }, { status: 400 });
		const inhalt = typeof prot.inhalt === 'string' ? JSON.parse(prot.inhalt) : prot.inhalt;
		const [{ unterschrift } = { unterschrift: null }] = await mitBetrieb(k, (tx) => tx`
			select unterschrift from app.baustellen_protokolle where id = ${params.id}`);
		await sendeProtokollEmail({
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
		}, auftrag.kundeEmail);
		return json({ ok: true, empfaenger: auftrag.kundeEmail });
	} catch (e) {
		return alsAntwort(e);
	}
};