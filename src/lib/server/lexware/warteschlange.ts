import { mitBetrieb, type Kontext } from '../db';
import { berlinTag } from '../../zeit';
import { LexwareFehler, type LexwareClient } from './client';

/**
 * Ausgangs-Warteschlange für Lexware (Plan Abschnitt 4 „Was passiert, wenn Lexware nicht erreichbar ist“).
 *
 * - `stelleEin`: Auftrag speichern; derselbe Idempotenz-Schlüssel im selben Betrieb ergibt nie einen zweiten Auftrag
 *   (Doppelklick, Wiederholung, zwei Geräte).
 * - `arbeiteAb`: holt fällige Aufträge (`for update skip locked`), führt sie über den Handler aus.
 *   * Erfolg → erledigt (lexware_id gespeichert).
 *   * 429 / 5xx / Netz / Zeit → wartet, Abstand 30 s · 2^(Versuch-1), höchstens 6 h; bei 429 die Wartezeit von Lexware;
 *     ab 8 Versuchen → pruefen.
 *   * Zeit/Netz bei einem ANLEGENDEN Aufruf → ungewiss: Ob Lexware den Beleg/Kontakt schon angelegt hat, ist unklar. Vor
 *     dem Neuversuch fragt `vorhanden()` in Lexware nach (Marke `CRM-…` im Datensatz) – so entsteht kein Doppelbeleg.
 *     Ein Prozessabbruch mitten im Aufruf (Status „laeuft“, Sperre abgelaufen) gilt ebenso als ungewiss.
 *   * 401 → pruefen, Verbindung „Schlüssel ungültig“, Aufgabe für den Chef; andere 4xx → pruefen + Aufgabe.
 */

export type LexwareArt =
	| 'kontakt_anlegen'
	| 'kontakt_aktualisieren'
	| 'kontakte_abgleichen'
	| 'belege_abgleichen'
	| 'abos_einrichten'
	// Phase 2: Angebot festschreiben → PDF/Versand; Annahme → Auftragsbestätigung → PDF/Versand
	| 'angebot_festschreiben'
	| 'angebot_versand'
	| 'ab_anlegen'
	| 'ab_versand'
	// Phase 3: Rechnung anlegen → holen (Spiegel, PDF); Zahlungsstand; Mahnung anlegen → PDF
	| 'rechnung_anlegen'
	| 'rechnung_holen'
	| 'zahlung_holen'
	| 'mahnung_anlegen'
	| 'mahnung_versand';

export type HandlerErgebnis = { lexwareId?: string | null; ergebnis?: Record<string, unknown> | null };
export type Handler = {
	/** Legt der Aufruf etwas in Lexware an (dann Zeitüberschreitung = ungewiss)? */
	anlegend?: boolean;
	ausfuehren(c: LexwareClient, nutzlast: any, k: Kontext, auftragId: string): Promise<HandlerErgebnis>;
	/** Nach ungewissem Ausgang: schon in Lexware vorhanden? → dessen ID (der Auftrag gilt dann als erledigt). */
	vorhanden?(c: LexwareClient, nutzlast: any, k: Kontext): Promise<string | null>;
	/** Nach Erfolg (z. B. Lexware-ID am Kunden merken). */
	nachher?(k: Kontext, nutzlast: any, r: HandlerErgebnis): Promise<void>;
	/** Endgültig gescheitert (Status „pruefen“): z. B. am Angebot „Fehler“ anzeigen. */
	beiFehler?(k: Kontext, nutzlast: any, text: string): Promise<void>;
};
export type HandlerTabelle = Partial<Record<LexwareArt, Handler>>;

export const MAX_VERSUCHE = 8;
export function abstandSekunden(versuch: number): number {
	return Math.min(30 * 2 ** Math.max(0, versuch - 1), 6 * 3600);
}

export async function stelleEin(
	k: Kontext,
	a: { art: LexwareArt; nutzlast?: Record<string, unknown>; idempotenz: string; abSofort?: boolean }
): Promise<{ id: string; neu: boolean }> {
	const von = /^[0-9a-f-]{36}$/i.test(k.benutzerId) ? k.benutzerId : null;
	return mitBetrieb(k, async (tx) => {
		const [neu] = await tx`
			insert into app.lexware_auftraege (betrieb_id, art, nutzlast, idempotenz, von_benutzer)
			values (${k.betriebId}, ${a.art}, ${tx.json((a.nutzlast ?? {}) as never)}, ${a.idempotenz}, ${von})
			on conflict (betrieb_id, idempotenz) do nothing returning id`;
		if (neu) return { id: neu.id as string, neu: true };
		const [alt] = await tx`select id from app.lexware_auftraege where betrieb_id = ${k.betriebId} and idempotenz = ${a.idempotenz}`;
		return { id: alt.id as string, neu: false };
	});
}

/** Aufgabe + Glocke für den Chef (einmal je Titel, solange offen). */
export async function meldeProblem(k: Kontext, titel: string, text: string): Promise<void> {
	const wer = /^[0-9a-f-]{36}$/i.test(k.benutzerId) ? k.benutzerId : null;
	await mitBetrieb(k, async (tx) => {
		const [offen] = await tx`select id from app.todos where betrieb_id = ${k.betriebId} and titel = ${titel} and erledigt_am is null limit 1`;
		if (offen) return;
		const [t] = await tx`
			insert into app.todos (betrieb_id, titel, beschreibung, zustaendig_id, faellig)
			values (${k.betriebId}, ${titel.slice(0, 200)}, ${text.slice(0, 500)}, ${wer}, ${berlinTag(new Date())}) returning id`;
		if (wer) {
			const [er] = await tx`
				insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
				values (${k.betriebId}, ${wer}, ${t.id}, now(), ${titel.slice(0, 300)}, ${text.slice(0, 500)}, '/einstellungen/lexware') returning id`;
			await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${er.id} and betrieb_id = ${k.betriebId}`;
		}
	});
}

type Geholt = { id: string; art: LexwareArt; nutzlast: any; versuche: number; vorher: string };

/**
 * Holt den nächsten fälligen Auftrag und sperrt ihn. Die Sperre (20 Minuten) muss länger sein als der längste Lauf eines
 * Handlers (z. B. Belegabgleich: bis zu 40 Abrufe à 20 s Zeitlimit) – sonst holte ein zweiter Lauf denselben Auftrag,
 * während der erste noch arbeitet (Gefahr doppelter Belege).
 */
async function holeNaechsten(k: Kontext): Promise<Geholt | null> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		with n as (
			select id, status from app.lexware_auftraege
			where betrieb_id = ${k.betriebId}
				and ((status in ('wartet', 'ungewiss') and naechster_versuch <= now()) or (status = 'laeuft' and gesperrt_bis < now()))
			order by naechster_versuch, angelegt limit 1 for update skip locked)
		update app.lexware_auftraege a set status = 'laeuft', versuche = a.versuche + 1, gesperrt_bis = now() + interval '20 minutes'
		from n where a.id = n.id and a.betrieb_id = ${k.betriebId}
		returning a.id, a.art, a.nutzlast, a.versuche, n.status as vorher`);
	return (z as unknown as Geholt) ?? null;
}

async function erledigt(k: Kontext, id: string, r: HandlerErgebnis) {
	await mitBetrieb(k, (tx) => tx`
		update app.lexware_auftraege set status = 'erledigt', erledigt_am = now(), gesperrt_bis = null, letzter_fehler = null,
			lexware_id = ${r.lexwareId ?? null}, ergebnis = ${r.ergebnis ? tx.json(r.ergebnis as never) : null}
		where id = ${id} and betrieb_id = ${k.betriebId}`);
}

const ART_NAME: Record<LexwareArt, string> = {
	kontakt_anlegen: 'Kunde in Lexware anlegen',
	kontakt_aktualisieren: 'Kunde in Lexware aktualisieren',
	kontakte_abgleichen: 'Kunden mit Lexware abgleichen',
	belege_abgleichen: 'Belege aus Lexware abgleichen',
	abos_einrichten: 'Rückmeldungen von Lexware einrichten',
	angebot_festschreiben: 'Angebot in Lexware festschreiben',
	angebot_versand: 'Angebot-PDF aus Lexware holen und senden',
	ab_anlegen: 'Auftragsbestätigung in Lexware anlegen',
	ab_versand: 'Auftragsbestätigung-PDF aus Lexware holen und senden',
	rechnung_anlegen: 'Rechnung in Lexware anlegen',
	rechnung_holen: 'Rechnung aus Lexware holen (Nummer, PDF)',
	zahlung_holen: 'Zahlungsstand aus Lexware holen',
	mahnung_anlegen: 'Mahnung in Lexware anlegen',
	mahnung_versand: 'Mahnungs-PDF aus Lexware holen'
};

async function fehlgeschlagen(k: Kontext, g: Geholt, h: Handler, e: unknown) {
	const lf = e instanceof LexwareFehler ? e : null;
	const text = (lf ? lf.message : 'Unerwarteter Fehler bei der Verarbeitung.').slice(0, 1000);
	if (!lf) console.error('Lexware-Warteschlange:', e);
	if (lf?.wiederholbar && g.versuche < MAX_VERSUCHE) {
		// Anlegen (Rechnung, Angebot, Kontakt …): Bei Zeitüberschreitung, Netzfehler UND Serverfehler (5xx) ist unklar, ob
		// Lexware den Beleg schon angelegt hat (z. B. 502/504 vom Gateway nach erfolgreichem Anlegen) → vor dem nächsten
		// Versuch erst nachsehen („ungewiss“), nie blind ein zweites Mal anlegen
		const ungewiss = !!h.anlegend && (lf.art === 'zeit' || lf.art === 'netz' || lf.art === 'server');
		const nach = lf.nachSekunden ?? abstandSekunden(g.versuche);
		await mitBetrieb(k, (tx) => tx`
			update app.lexware_auftraege set status = ${ungewiss || g.vorher === 'ungewiss' ? 'ungewiss' : 'wartet'}, gesperrt_bis = null,
				letzter_fehler = ${text}, naechster_versuch = now() + make_interval(secs => ${nach})
			where id = ${g.id} and betrieb_id = ${k.betriebId}`);
		return;
	}
	await mitBetrieb(k, (tx) => tx`
		update app.lexware_auftraege set status = 'pruefen', gesperrt_bis = null, letzter_fehler = ${text}
		where id = ${g.id} and betrieb_id = ${k.betriebId}`);
	await h.beiFehler?.(k, g.nutzlast, text).catch((err) => console.error('Lexware-Warteschlange (beiFehler):', (err as Error).message));
	if (lf?.art === 'schluessel') {
		await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set status = 'schluessel_ungueltig', letzter_fehler = ${text} where betrieb_id = ${k.betriebId}`);
		await meldeProblem(k, 'Lexware-Schlüssel erneuern', 'Lexware lehnt den API-Schlüssel ab (abgelaufen oder widerrufen). Bitte in Lexware einen neuen Schlüssel anlegen und unter Einstellungen → Lexware verbinden eintragen.');
		return;
	}
	await meldeProblem(k, `Lexware: ${ART_NAME[g.art]} prüfen`, `${text} – Einstellungen → Lexware verbinden → Warteschlange: „Erneut versuchen“ oder „Abbrechen“.`);
}

/** Fällige Aufträge eines Betriebs abarbeiten (Hintergrund-Dienst oder „Jetzt ausführen“). */
export async function arbeiteAb(
	k: Kontext,
	client: LexwareClient,
	handler: HandlerTabelle,
	o: { max?: number } = {}
): Promise<{ erledigt: number; fehler: number }> {
	const z = { erledigt: 0, fehler: 0 };
	for (let i = 0; i < (o.max ?? 50); i++) {
		const g = await holeNaechsten(k);
		if (!g) break;
		const h = handler[g.art];
		if (!h) {
			await mitBetrieb(k, (tx) => tx`update app.lexware_auftraege set status = 'pruefen', letzter_fehler = 'Unbekannte Art' where id = ${g.id} and betrieb_id = ${k.betriebId}`);
			z.fehler++;
			continue;
		}
		try {
			let r: HandlerErgebnis | null = null;
			if ((g.vorher === 'ungewiss' || g.vorher === 'laeuft') && h.vorhanden) {
				const da = await h.vorhanden(client, g.nutzlast, k);
				if (da) r = { lexwareId: da, ergebnis: { gefunden: true } };
			}
			r ??= await h.ausfuehren(client, g.nutzlast, k, g.id);
			await erledigt(k, g.id, r);
			await h.nachher?.(k, g.nutzlast, r);
			z.erledigt++;
		} catch (e) {
			await fehlgeschlagen(k, g, h, e);
			z.fehler++;
			// Ratenlimit/Ausfall: nicht weiter auf Lexware einhämmern
			if (e instanceof LexwareFehler && (e.art === 'grenze' || e.art === 'server' || e.art === 'schluessel' || e.art === 'netz')) break;
		}
	}
	return z;
}

/** „Erneut versuchen“ bzw. „Abbrechen“ (Einstellungsseite). */
export async function auftragErneut(k: Kontext, id: string): Promise<void> {
	await mitBetrieb(k, (tx) => tx`
		update app.lexware_auftraege set status = case when status = 'pruefen' then 'ungewiss' else status end, naechster_versuch = now(), versuche = 0
		where id = ${id} and betrieb_id = ${k.betriebId} and status in ('pruefen', 'wartet', 'ungewiss')`);
}
/**
 * Abbrechen. Mit `handler` bekommt der Vorgang dahinter Bescheid (`beiFehler`, z. B. Rechnung → Phase „fehler“) –
 * sonst bliebe etwa eine Rechnung für immer „wartet“ und ließe sich weder neu anlegen noch verwerfen.
 */
export async function auftragAbbrechen(k: Kontext, id: string, handler?: HandlerTabelle): Promise<void> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		update app.lexware_auftraege set status = 'abgebrochen', erledigt_am = now(), letzter_fehler = coalesce(letzter_fehler, 'abgebrochen')
		where id = ${id} and betrieb_id = ${k.betriebId} and status in ('pruefen', 'wartet', 'ungewiss')
		returning art, nutzlast`);
	if (!z) return;
	await handler?.[z.art as LexwareArt]?.beiFehler?.(k, z.nutzlast, 'Abgebrochen').catch((err) => console.error('Lexware-Warteschlange (beiFehler):', (err as Error).message));
}

export type AuftragZeile = { id: string; art: LexwareArt; name: string; status: string; versuche: number; letzterFehler: string | null; naechsterVersuch: string; angelegt: string };
export async function listeAuftraege(k: Kontext, nurOffen = true): Promise<AuftragZeile[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select id, art, status, versuche, letzter_fehler, naechster_versuch, angelegt from app.lexware_auftraege
		where betrieb_id = ${k.betriebId} ${nurOffen ? tx`and status not in ('erledigt', 'abgebrochen')` : tx``}
		order by angelegt desc limit 100`);
	return z.map((r) => ({
		id: r.id,
		art: r.art,
		name: ART_NAME[r.art as LexwareArt] ?? r.art,
		status: r.status,
		versuche: r.versuche,
		letzterFehler: r.letzter_fehler,
		naechsterVersuch: new Date(r.naechster_versuch).toISOString(),
		angelegt: new Date(r.angelegt).toISOString()
	}));
}
