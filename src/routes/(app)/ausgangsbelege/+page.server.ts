import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** „Ausgangsbelege“ öffnet den ersten Reiter (Angebote); Filter in der Adresse bleiben erhalten. */
export const load: PageServerLoad = ({ url }) => redirect(307, `/ausgangsbelege/angebote${url.search}`);
