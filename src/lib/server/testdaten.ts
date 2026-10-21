import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';

/**
 * Aufräumen nach Browser-Tests (Jamil msgs 3075/3076: liegengebliebene „E2E Besichtigung …“ in der Vorschau). Nur im
 * Testmodus erreichbar (`/api/testmodus/aufraeumen`). Gelöscht wird ausschließlich, was eindeutig zu EINEM Testlauf
 * gehört – erkennbar an der Kennung des Laufs (z. B. „desktop-mvhboomc“):
 *
 * - Terminarten, deren Name mit „E2E “ beginnt und die Kennung enthält, samt ihren Buchungen (über die
 *   Datenbankfunktion `app.testdaten_buchungen_loeschen`, die selbst nur „E2E “-Terminarten zulässt), Links und
 *   Arbeitszeiten (Kaskade);
 * - Einsätze, Aufträge und Kunden, die diese Buchungen angelegt haben – Kunden nur, wenn Name oder E-Mail die Kennung
 *   enthalten und keine weiteren Aufträge haben;
 * - eigene Termine (Einsätze ohne Auftrag), deren Titel mit „E2E “ beginnt und die Kennung enthält.
 */
export type Aufgeraeumt = { terminarten: number; buchungen: number; einsaetze: number; auftraege: number; kunden: number };

const KENNUNG = /^[A-Za-z0-9_-]{6,60}$/;

export async function raeumeTestdatenAuf(k: Kontext, kennung: unknown): Promise<Aufgeraeumt> {
	if (typeof kennung !== 'string' || !KENNUNG.test(kennung)) throw new ApiFehler(400, 'Kennung des Testlaufs fehlt (6–60 Zeichen, a–z, 0–9, - und _).');
	return mitBetrieb(k, async (tx) => {
		const aus: Aufgeraeumt = { terminarten: 0, buchungen: 0, einsaetze: 0, auftraege: 0, kunden: 0 };
		const dienste = await tx`
			select id from app.buchung_dienste
			where betrieb_id = ${k.betriebId} and name like 'E2E %' and strpos(name, ${kennung}) > 0`;
		const ids = dienste.map((d) => d.id as string);
		const buchungen = ids.length
			? await tx`select auftrag_id, kunde_id, einsatz_id from app.buchungen where betrieb_id = ${k.betriebId} and dienst_id = any(${ids}::uuid[])`
			: [];
		const einsatzIds = buchungen.map((b) => b.einsatz_id).filter(Boolean) as string[];
		const auftragIds = [...new Set(buchungen.map((b) => b.auftrag_id).filter(Boolean))] as string[];
		const kundeIds = [...new Set(buchungen.map((b) => b.kunde_id).filter(Boolean))] as string[];

		if (einsatzIds.length) aus.einsaetze += (await tx`delete from app.einsaetze where betrieb_id = ${k.betriebId} and id = any(${einsatzIds}::uuid[]) returning id`).length;
		for (const id of ids) {
			const [z] = await tx`select app.testdaten_buchungen_loeschen(${id}::uuid) as n`;
			aus.buchungen += z.n as number;
		}
		if (auftragIds.length) {
			aus.einsaetze += (await tx`delete from app.einsaetze where betrieb_id = ${k.betriebId} and auftrag_id = any(${auftragIds}::uuid[]) returning id`).length;
			aus.auftraege += (await tx`delete from app.auftraege where betrieb_id = ${k.betriebId} and id = any(${auftragIds}::uuid[]) returning id`).length;
		}
		if (kundeIds.length) {
			aus.kunden += (
				await tx`
					delete from app.kunden kd
					where kd.betrieb_id = ${k.betriebId} and kd.id = any(${kundeIds}::uuid[])
						and (strpos(coalesce(kd.nachname, ''), ${kennung}) > 0 or strpos(coalesce(kd.email::text, ''), ${kennung}) > 0)
						and not exists (select 1 from app.auftraege a where a.kunde_id = kd.id and a.betrieb_id = kd.betrieb_id)
					returning kd.id`
			).length;
		}
		aus.einsaetze += (
			await tx`
				delete from app.einsaetze
				where betrieb_id = ${k.betriebId} and auftrag_id is null and titel like 'E2E %' and strpos(titel, ${kennung}) > 0
				returning id`
		).length;
		if (ids.length) aus.terminarten += (await tx`delete from app.buchung_dienste where betrieb_id = ${k.betriebId} and id = any(${ids}::uuid[]) returning id`).length;
		return aus;
	});
}
