import { mitBetrieb, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { betriebKontext, pruefeRecht, type Recht } from './rechte';
import { istModul, MODULE, sortiereTarifSchluessel, type Modul, type TarifInfo } from '../tarife';

export { MODULE, type Modul, type TarifInfo };

/**
 * Tarife und Freischaltungen. Alle Abfragen laufen als `crm_app` im Mandantenkontext des Betriebs (RLS):
 * Der Tarif eines Betriebs wird nur über dessen eigene Zeile in `betriebe` gefunden, nie mandantenübergreifend.
 * Die Tarif-Tabelle selbst ist ein gemeinsamer Katalog (nur lesbar).
 */

/** Für Funktionen ohne angemeldeten Benutzer (`hatModul`, `pruefeGrenze`): der Kontext braucht einen Eintrag. */
const KEIN_BENUTZER = '00000000-0000-0000-0000-000000000000';

const kontextFuer = (betriebId: string) => ({ betriebId, benutzerId: KEIN_BENUTZER });

function pruefeModulName(modul: string): asserts modul is Modul {
	// Ein Tippfehler im Quelltext soll auffallen, statt still „nicht enthalten“ zu ergeben.
	if (!istModul(modul)) throw new Error(`Unbekanntes Modul: ${modul}`);
}

/** Hat der Tarif des Betriebs dieses Modul? */
export async function hatModul(betriebId: string, modul: Modul): Promise<boolean> {
	pruefeModulName(modul);
	return mitBetrieb(kontextFuer(betriebId), async (tx) => {
		const [z] = await tx`
			select (${modul}::text = any(t.module)) as drin
			from app.betriebe b
			join app.tarife t on t.id = b.tarif_id
			where b.id = ${betriebId}`;
		return z?.drin === true;
	});
}

/**
 * Wirft 401 ohne Anmeldung, 403 für Plattform-Admins (kein Betrieb) und 402 `Im aktuellen Tarif nicht enthalten`,
 * wenn der Tarif des Betriebs das Modul nicht hat. `tarifMit` nennt die Tarife, die es enthalten
 * (aufsteigend nach Preisstufe: basis, profi, premium, test zuletzt).
 */
export async function pruefeModul(locals: { nutzer: Nutzer | null }, modul: Modul): Promise<void> {
	pruefeModulName(modul);
	const k = betriebKontext(locals);
	const tarifMit = await mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select (${modul}::text = any(t.module)) as drin
			from app.betriebe b
			join app.tarife t on t.id = b.tarif_id
			where b.id = ${k.betriebId}`;
		if (z?.drin === true) return null;
		const mit = await tx<{ schluessel: string }[]>`
			select schluessel from app.tarife where ${modul}::text = any(module)`;
		return sortiereTarifSchluessel(mit.map((t) => t.schluessel));
	});
	if (tarifMit) throw new ApiFehler(402, 'Im aktuellen Tarif nicht enthalten', { tarifMit });
}

/**
 * Wirft 409 `Benutzergrenze des Tarifs erreicht`, wenn der Betrieb schon so viele aktive Benutzer hat, wie sein
 * Tarif erlaubt (ein weiterer wäre einer zu viel). Deaktivierte Benutzer zählen nicht mit. Ohne Grenze im Tarif
 * ist alles erlaubt.
 *
 * Wer den Benutzer anschließend anlegt oder aktiviert, übergibt seine eigene Transaktion `tx` (aus `mitBetrieb`
 * für denselben Betrieb): Dann wird für die Dauer der Transaktion eine Sperre pro Betrieb gehalten, und zwei
 * gleichzeitige Anlegen-Vorgänge können die Grenze nicht beide „noch knapp“ unterlaufen.
 */
export async function pruefeGrenze(
	betriebId: string,
	grenze: 'benutzer',
	tx?: TransactionSql
): Promise<void> {
	const lauf = async (t: TransactionSql) => {
		const [kontext] = await t`select nullif(current_setting('app.betrieb_id', true), '') as id`;
		if (kontext?.id !== betriebId) throw new Error('pruefeGrenze: Transaktion gehört zu einem anderen Betrieb');
		await t`select pg_advisory_xact_lock(hashtextextended(${'benutzergrenze:' + betriebId}, 0))`;
		const [z] = await t`
			select t.grenzen,
				(select count(*)::int from app.benutzer u where u.betrieb_id = b.id and u.aktiv) as anzahl
			from app.betriebe b
			join app.tarife t on t.id = b.tarif_id
			where b.id = ${betriebId}`;
		const erlaubt: unknown = z?.grenzen?.[grenze];
		if (typeof erlaubt !== 'number') return;
		if (z.anzahl >= erlaubt) throw new ApiFehler(409, 'Benutzergrenze des Tarifs erreicht');
	};
	if (tx) return lauf(tx);
	return mitBetrieb(kontextFuer(betriebId), lauf);
}

/** Recht (401/403) und Modul (402) in einem: der übliche Einstieg für Endpunkte eines Moduls. */
export async function darf(locals: { nutzer: Nutzer | null }, modul: Modul, recht: Recht): Promise<void> {
	pruefeRecht(locals, recht);
	await pruefeModul(locals, modul);
}

/** Alle Tarife (für Oberflächen, z. B. `TarifHinweis`). */
export async function listeTarife(k: { betriebId: string; benutzerId: string }): Promise<TarifInfo[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx<{ schluessel: string; name: string; module: string[] }[]>`
			select schluessel, name, module from app.tarife`;
		return sortiereTarifSchluessel(z.map((t) => t.schluessel)).map((s) => z.find((t) => t.schluessel === s)!);
	});
}

/**
 * Nur-Lesezugriff: Ist der Betrieb des Nutzers zurzeit auf Lesen beschränkt?
 * - Status `ueberfaellig`: nach `abo_ende` + 14 Tagen Schonfrist,
 * - Status `gekuendigt`: ab dem Tag nach `abo_ende`.
 * „Heute“ ist der Kalendertag in Europa/Berlin (in der Datenbank ausgewertet, nicht in der Zeitzone des Servers).
 * Ohne `abo_ende` gibt es keinen Stichtag und damit keine Einschränkung. `gesperrt` bekommt gar keine Sitzung.
 * Plattform-Admins (ohne Betrieb) sind nie betroffen. Nur bei diesen beiden Status wird die Datenbank gefragt.
 */
export async function istNurLesen(nutzer: Nutzer): Promise<boolean> {
	if (!nutzer.betriebId) return false;
	if (nutzer.betriebStatus !== 'ueberfaellig' && nutzer.betriebStatus !== 'gekuendigt') return false;
	return mitBetrieb({ betriebId: nutzer.betriebId, benutzerId: nutzer.id }, async (tx) => {
		const [z] = await tx`
			select coalesce(
				abo_ende is not null and case abo_status
					when 'ueberfaellig' then abo_ende + 14 < (now() at time zone 'Europe/Berlin')::date
					when 'gekuendigt' then abo_ende < (now() at time zone 'Europe/Berlin')::date
					else false
				end, false) as nur_lesen
			from app.betriebe where id = ${nutzer.betriebId}`;
		return z?.nur_lesen === true;
	});
}
