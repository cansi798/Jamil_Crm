import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { nachweis, teamUebersicht, zeitZugriff } from '$lib/server/zeiterfassung';
import { csv, stundenDezimal, ZEIT_ART_NAMEN } from '$lib/zeiterfassung';
import { berlinUhrzeit, berlinTag } from '$lib/zeit';
import { zeitenPdf } from '$lib/server/pdf/zeiten-pdf';
import { mitBetrieb } from '$lib/server/db';

/**
 * Arbeitszeitnachweis als Datei: `?format=csv|pdf&von=JJJJ-MM-TT&bis=JJJJ-MM-TT&person=<id>` (Person nur mit
 * „Zeiten aller verwalten“, sonst immer die eigenen). CSV mit Semikolon und BOM (Excel), Formeln entschärft.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const z = await zeitZugriff(locals);
		const format = url.searchParams.get('format') ?? 'csv';
		if (format !== 'csv' && format !== 'pdf') throw new ApiFehler(400, 'Unbekanntes Format.');
		// Teamübersicht (Chef/Büro, msg 2797) als CSV
		if (url.searchParams.get('team') === '1') {
			const von = url.searchParams.get('von') ?? '';
			const bis = url.searchParams.get('bis') ?? '';
			const team = await teamUebersicht(z, von, bis);
			const zeilen: (string | number | null)[][] = [['Mitarbeiter', 'Arbeit (h)', 'Pausen (h)', 'Fahrt (h)', 'km', 'Soll (h)', 'Saldo (h)', 'nicht freigegeben']];
			for (const t of team) zeilen.push([t.name, stundenDezimal(t.arbeitMin), stundenDezimal(t.pauseMin), stundenDezimal(t.fahrtMin), t.km, t.sollMin === null ? null : stundenDezimal(t.sollMin), t.sollMin === null ? null : stundenDezimal(t.arbeitMin - t.sollMin), t.offenFreigabe]);
			return new Response(csv(zeilen), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="Zeiten_Team_${von}_${bis}.csv"`, 'cache-control': 'no-store' } });
		}
		const n = await nachweis(z, {
			benutzerId: url.searchParams.get('person') ?? undefined,
			von: url.searchParams.get('von') ?? '',
			bis: url.searchParams.get('bis') ?? ''
		});
		const dateiname = `Arbeitszeitnachweis_${n.person.name.replace(/[^A-Za-z0-9]+/g, '-')}_${n.von}_${n.bis}`;
		const kopf = (typ: string, endung: string) => ({
			'content-type': typ,
			'content-disposition': `attachment; filename="${dateiname}.${endung}"`,
			'cache-control': 'no-store'
		});
		if (format === 'csv') {
			const zeilen: (string | number | null)[][] = [['Tag', 'Beginn', 'Ende', 'Art', 'Auftrag', 'Stunden', 'Pause (Min.)', 'km', 'Notiz', 'Korrektur', 'Freigegeben']];
			for (const e of n.eintraege) {
				const b = new Date(e.beginn);
				const ende = e.ende ? new Date(e.ende) : null;
				const min = ((ende ?? new Date()).getTime() - b.getTime()) / 60000 - e.pauseMin;
				zeilen.push([
					berlinTag(b),
					berlinUhrzeit(b),
					ende ? berlinUhrzeit(ende) : 'läuft',
					ZEIT_ART_NAMEN[e.art],
					`${e.auftragNummer ?? ''} ${e.auftragTitel ?? ''}`.trim(),
					stundenDezimal(min),
					e.pauseMin || null,
					e.km,
					e.notiz,
					e.manuell ? (e.korrekturGrund ?? 'ja') : null,
					e.freigegeben ? 'ja' : 'nein'
				]);
			}
			zeilen.push([]);
			zeilen.push(['Summe Arbeit (h)', stundenDezimal(n.summe.arbeitMin)]);
			zeilen.push(['Summe Pausen (h)', stundenDezimal(n.summe.pauseMin)]);
			zeilen.push(['Summe Fahrt (h)', stundenDezimal(n.summe.fahrtMin)]);
			zeilen.push(['Summe km', n.summe.km]);
			if (n.sollMin !== null) {
				zeilen.push(['Soll (h)', stundenDezimal(n.sollMin)]);
				zeilen.push(['Saldo (h)', stundenDezimal(n.summe.arbeitMin - n.sollMin)]);
			}
			return new Response(csv(zeilen), { headers: kopf('text/csv; charset=utf-8', 'csv') });
		}
		const [p] = await mitBetrieb(z.k, (tx) => tx`select firmenname from app.betrieb_profil where betrieb_id = ${z.k.betriebId}`);
		const pdf = await zeitenPdf({ firmenname: p?.firmenname ?? null, person: n.person.name, von: n.von, bis: n.bis, tage: n.tage, eintraege: n.eintraege, sollMin: n.sollMin, erstellt: new Date() });
		return new Response(pdf as BodyInit, { headers: kopf('application/pdf', 'pdf') });
	} catch (e) {
		return alsAntwort(e);
	}
};
