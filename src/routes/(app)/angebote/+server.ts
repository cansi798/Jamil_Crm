import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Die Angebotsliste liegt seit „Ausgangsbelege“ (Jamil msg 2948) unter /ausgangsbelege/angebote. Alte Lesezeichen und
 * Links (`/angebote?status=…`) werden mit allen Filtern dorthin umgeleitet. Die Angebote selbst bleiben unter
 * /angebote/<id> (Links in Mails, Aufgaben und Verlauf gelten weiter).
 */
export const GET: RequestHandler = ({ url }) => redirect(308, `/ausgangsbelege/angebote${url.search}`);
