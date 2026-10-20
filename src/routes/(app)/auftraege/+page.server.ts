import type { PageServerLoad } from './$types';
import { listeAuftraege, MAX_AUFTRAEGE, sichtVon } from '$lib/server/auftraege';
import { ladeBoard, MAX_JE_SPALTE } from '$lib/server/auftrag-board';
import { SUCHE_MAX_ZEICHEN } from '$lib/server/kunden';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { istStatus } from '$lib/auftrag-status';
import { listeQuellen } from '$lib/server/quellen';
import { UUID } from '$lib/server/kunden';

/**
 * Aufträge als Board (Standard: Kacheln je Status, verschiebbar) oder als Liste (`?ansicht=liste`, mit Status-Reitern
 * `?status=`, unbekannt → alle). Suche (`?suche=`, zu lang → gekürzt) und „Meine“ (`?meine=1`) gelten für beide
 * Ansichten. Mit nur `auftraege.lesen` erscheinen nur die eigenen Aufträge. Angebotswerte auf den Kacheln nur mit
 * `preise.sehen` und Modul „angebote“.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	const ansicht = url.searchParams.get('ansicht') === 'liste' ? 'liste' : 'board';
	const roh = url.searchParams.get('status');
	const status = istStatus(roh) ? roh : null;
	const suche = (url.searchParams.get('suche') ?? '').slice(0, SUCHE_MAX_ZEICHEN);
	// „Meine“ (zuständig, eigene Aufgabe oder eigener Termin): wer nur eigene Aufträge sieht, sieht ohnehin nur diese;
	// wer alle sieht (Chef/Büro), kann umschalten (`?meine=1`)
	const meine = url.searchParams.get('meine') === '1';
	const sicht = sichtVon(nutzer);
	// Filter Quelle (Wunsch Jamil msg 2593): ?quelle=<id> oder ?quelle=ohne
	const quellen = await listeQuellen(k);
	const rohQuelle = url.searchParams.get('quelle') ?? '';
	const quelle = rohQuelle === 'ohne' || (UUID.test(rohQuelle) && quellen.some((q) => q.id === rohQuelle)) ? rohQuelle : null;
	// Filter „Nachfassen fällig“ (Wunsch Jamil msg 2674): ?nachfassen=faellig
	const nachfassenFaellig = url.searchParams.get('nachfassen') === 'faellig';
	const gemeinsam = {
		quellen: quellen.map((q) => ({ id: q.id, name: q.name, aktiv: q.aktiv })),
		quelle,
		nachfassenFaellig,
		ansicht,
		status,
		suche,
		meine,
		alle: hatRecht(nutzer, 'auftraege.alle_lesen'),
		darfBearbeiten: hatRecht(nutzer, 'auftraege.bearbeiten')
	} as const;
	if (ansicht === 'liste') {
		const auftraege = await alsSeitenFehler(() =>
			listeAuftraege(k, sicht, { status: status ?? undefined, suche, meine, quelleId: quelle ?? undefined, nachfassenFaellig })
		);
		return { ...gemeinsam, auftraege, board: null, maxTreffer: MAX_AUFTRAEGE, mitPreisen: false };
	}
	const mitPreisen = hatRecht(nutzer, 'preise.sehen') && (await moduleDesBetriebs(k)).includes('angebote');
	const board = await alsSeitenFehler(() => ladeBoard(k, sicht, { suche, meine, mitPreisen, quelleId: quelle ?? undefined, nachfassenFaellig }));
	return { ...gemeinsam, auftraege: [], board, maxTreffer: MAX_JE_SPALTE, mitPreisen };
};
