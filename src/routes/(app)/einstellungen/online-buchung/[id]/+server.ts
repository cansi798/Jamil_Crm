import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Alte Adresse eines „Dienstes“ (vor Jamil msg 3074): Terminarten stehen jetzt unter /einstellungen/terminarten. */
export const GET: RequestHandler = ({ params }) => {
	redirect(301, `/einstellungen/terminarten/${encodeURIComponent(params.id)}`);
};
