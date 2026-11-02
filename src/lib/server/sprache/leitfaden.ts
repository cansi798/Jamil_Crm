/**
 * Sprachbefehle zum Leitfaden beim Termin (Jamil msg 4353; ständige Regel: jede Funktion bekommt eine Sprachaktion):
 * - „Leitfaden starten / fortsetzen (für Demir)“ → öffnet den Leitfaden des passenden Termins (nur lesend, kein Speichern)
 * - „Wie weit ist der Leitfaden bei Demir?“ → Stand je Auftrag (nur lesend)
 * - „Im Leitfaden: E-Mail ist max@…, bevorzugt per WhatsApp“ → Eingaben in den Leitfaden, erst nach Bestätigung
 * Gesucht wird unter den eigenen Terminen von heute bis in 7 Tagen (bzw. allen, wer die Plantafel bearbeiten darf).
 */
import { mitBetrieb, type Kontext } from '../db';
import { hatRecht } from '../rechte';
import { hatModul } from '../tarif';
import { leitfaedenFuerTermine, leitfaedenZumAuftrag, type LeitfadenStand } from '../leitfaden';
import { listeAuftraege, sichtVon } from '../auftraege';
import { berlinTag, berlinUhrzeit, tagDeutsch, tagesGrenzen, tagPlus } from '../../zeit';
import { KUNDEN_FELD_NAMEN, kundenWertText, STATUS_NAMEN, type KundenFeld } from '../../leitfaden';
import type { Karte } from './aufloesen';

export type TerminLeitfaden = { einsatzId: string; beginn: string; stand: LeitfadenStand };

const woerter = (t: string) =>
	t
		.toLowerCase()
		.replace(/\b(?:leitfaden|leitfadens|für|fuer|bei|beim|von|kunde|kundin|familie|firma|herr|frau|den|dem|der|die|das|termin)\b/g, ' ')
		.replace(/[?.!,:]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length >= 2);

/** Termine mit Leitfaden (heute bis +7 Tage), optional passend zum gesprochenen Kunden/Auftrag; offene zuerst. */
export async function termineMitLeitfaden(k: Kontext, nutzer: Nutzer, suche: string | undefined, jetzt: Date): Promise<TerminLeitfaden[]> {
	if (!(await hatModul(k.betriebId, 'plantafel'))) return [];
	const heute = berlinTag(jetzt);
	const von = tagesGrenzen(heute).beginn;
	const bis = tagesGrenzen(tagPlus(heute, 7)).ende;
	const alle = hatRecht(nutzer, 'plantafel.bearbeiten');
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select e.id, e.beginn from app.einsaetze e
		where e.betrieb_id = ${k.betriebId} and e.auftrag_id is not null and e.ende >= ${von} and e.beginn < ${bis}
			${alle && suche ? tx`` : tx`and e.benutzer_id = ${nutzer.id}`}
		order by e.beginn, e.id limit 60`);
	const staende = await leitfaedenFuerTermine(k, nutzer, zeilen.map((z) => z.id as string));
	const w = woerter(suche ?? '');
	const liste = zeilen
		.filter((z) => staende.has(z.id))
		.map((z) => ({ einsatzId: z.id as string, beginn: new Date(z.beginn).toISOString(), stand: staende.get(z.id)! }))
		.filter((t) => w.every((x) => `${t.stand.kundeName} ${t.stand.auftragTitel} ${t.stand.auftragNummer}`.toLowerCase().includes(x)));
	return [...liste.filter((t) => t.stand.status === 'offen'), ...liste.filter((t) => t.stand.status !== 'offen')];
}

const wannText = (iso: string) => `${tagDeutsch(berlinTag(new Date(iso))).slice(0, 6)} ${berlinUhrzeit(new Date(iso))}`;
const eintrag = (t: TerminLeitfaden) => ({
	zeit: wannText(t.beginn),
	titel: `${t.stand.kundeName || t.stand.auftragTitel} – ${t.stand.status === 'offen' ? `${t.stand.fortschritt.erledigt}/${t.stand.fortschritt.gesamt}` : STATUS_NAMEN[t.stand.status]}`,
	ort: null,
	link: `/leitfaden/${t.einsatzId}`,
	ueberfaellig: false
});
const karte = (aktion: Karte['aktion'], titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
	aktion, titel, zeilen: [], auswahl: [], warnungen: [], fehler, aendern: null, ...(antwort ? { antwort } : {})
});

/** „Leitfaden starten / fortsetzen (für Demir)“ */
export async function beantworteLeitfadenOeffnen(k: Kontext, nutzer: Nutzer, kunde: string | undefined, jetzt: Date): Promise<Karte> {
	const liste = await termineMitLeitfaden(k, nutzer, kunde, jetzt);
	if (liste.length === 0) return karte('leitfaden_oeffnen', 'Leitfaden', kunde ? `Keinen Termin mit Leitfaden zu „${kunde}“ gefunden.` : 'In den nächsten Tagen hast du keinen Termin mit Leitfaden.');
	const t = liste[0];
	const eindeutig = liste.length === 1 || (!kunde && liste[0].stand.status === 'offen' && berlinTag(new Date(liste[0].beginn)) === berlinTag(jetzt));
	return karte('leitfaden_oeffnen', eindeutig ? `${t.stand.name}: ${t.stand.kundeName}` : 'Welcher Termin?', null, {
		...(eindeutig ? { oeffnen: `/leitfaden/${t.einsatzId}` } : {}),
		abschnitte: [{ titel: 'Termine mit Leitfaden', eintraege: liste.slice(0, 8).map(eintrag) }],
		vorlesen: eindeutig
			? `${t.stand.name} für ${t.stand.kundeName}: ${t.stand.fortschritt.erledigt} von ${t.stand.fortschritt.gesamt} erledigt – tippe auf Öffnen.`
			: `Ich habe ${liste.length} Termine mit Leitfaden gefunden – bitte einen antippen.`
	});
}

/** „Wie weit ist der Leitfaden bei Demir?“ / „Leitfaden-Stand von Auftrag A-2026-0867“ */
export async function beantworteLeitfadenStand(k: Kontext, nutzer: Nutzer, auftrag: string): Promise<Karte> {
	const suche = woerter(auftrag).join(' ').slice(0, 100);
	const treffer = suche ? await listeAuftraege(k, hatRecht(nutzer, 'auftraege.alle_lesen') ? { alle: true, benutzerId: nutzer.id } : sichtVon(nutzer), { suche }) : [];
	const mit: { a: (typeof treffer)[number]; l: LeitfadenStand }[] = [];
	for (const a of treffer.slice(0, 10)) for (const l of await leitfaedenZumAuftrag(k, a.id)) mit.push({ a, l });
	if (mit.length === 0) return karte('abfrage_leitfaden', 'Leitfaden', `Keinen Leitfaden zu „${auftrag}“ gefunden.`);
	const { a, l } = mit[0];
	const offen = l.schritte.filter((s) => l.fehlend.includes(s.id)).map((s) => s.titel);
	const zeilen = [
		`Stand: ${l.status === 'offen' ? `${l.fortschritt.erledigt} von ${l.fortschritt.gesamt} erledigt` : STATUS_NAMEN[l.status]}`,
		...(offen.length ? [`Pflicht noch offen: ${offen.join(', ')}`] : []),
		...(l.begruendung ? [`Begründung: ${l.begruendung}`] : []),
		...(l.benutzerName ? [`Termin: ${l.terminBeginn ? wannText(l.terminBeginn) : 'gelöscht'} · ${l.benutzerName}`] : [])
	];
	const link = `/auftraege/${a.id}#leitfaden`;
	return karte('abfrage_leitfaden', `${l.name} ${a.nummer}`, null, {
		oeffnen: link,
		abschnitte: [{ titel: `${a.nummer} ${a.titel} – ${a.kundeName}`, eintraege: zeilen.map((z) => ({ zeit: '', titel: z, ort: null, link, ueberfaellig: l.status === 'mit_begruendung' })) }],
		vorlesen: `${l.name} bei ${a.kundeName}: ${l.status === 'offen' ? `${l.fortschritt.erledigt} von ${l.fortschritt.gesamt} erledigt${offen.length ? `, offen: ${offen.join(', ')}` : ''}` : STATUS_NAMEN[l.status]}.`
	});
}

export type LeitfadenEingabeDaten = { kunde?: string; email?: string; telefon?: string; bevorzugter_kontakt?: 'email' | 'chat' | 'telefon'; notiz?: string };

/**
 * Eingaben per Sprache für die Bestätigungskarte: passender Termin (eindeutig) und je gesprochenem Wert der Schritt des
 * Leitfadens (Kundendaten bzw. erste Notiz). Gibt Zeilen, Werte, Warnungen und – wenn etwas fehlt – den Grund zurück.
 */
export async function leitfadenEingabeVorschau(
	k: Kontext,
	nutzer: Nutzer,
	d: LeitfadenEingabeDaten,
	jetzt: Date
): Promise<{ fehlt: string | null; zeilen: { label: string; wert: string }[]; warnungen: string[]; werte: Record<string, unknown> }> {
	const liste = (await termineMitLeitfaden(k, nutzer, d.kunde, jetzt)).filter((t) => t.stand.status === 'offen');
	const heute = liste.filter((t) => berlinTag(new Date(t.beginn)) === berlinTag(jetzt));
	const ziel = liste.length === 1 ? liste[0] : heute.length === 1 && !d.kunde ? heute[0] : null;
	if (!ziel) {
		return {
			fehlt: liste.length === 0 ? 'Kein offener Leitfaden gefunden.' : `Mehrere offene Leitfäden (${liste.slice(0, 3).map((t) => t.stand.kundeName).join(', ')}) – bitte den Kunden dazusagen.`,
			zeilen: [],
			warnungen: [],
			werte: {}
		};
	}
	const s = ziel.stand;
	const zeilen = [{ label: 'Leitfaden', wert: `${s.name} – ${s.kundeName} (${wannText(ziel.beginn)})` }];
	const warnungen: string[] = [];
	const eingaben: { schrittId: string; wert: unknown }[] = [];
	const felder: [KundenFeld, unknown][] = [
		['email', d.email],
		['telefon', d.telefon],
		['bevorzugter_kontakt', d.bevorzugter_kontakt]
	];
	for (const [feld, wert] of felder) {
		if (wert === undefined || wert === '') continue;
		const schritt = s.schritte.find((x) => x.typ === 'kundendaten' && x.feld === feld);
		if (!schritt) {
			warnungen.push(`Der Leitfaden hat keinen Schritt für „${KUNDEN_FELD_NAMEN[feld]}“ – wird nicht gespeichert.`);
			continue;
		}
		eingaben.push({ schrittId: schritt.id, wert });
		zeilen.push({ label: KUNDEN_FELD_NAMEN[feld], wert: kundenWertText(feld, wert) });
	}
	if (d.notiz) {
		const n = s.schritte.find((x) => x.typ === 'notiz');
		if (n) {
			eingaben.push({ schrittId: n.id, wert: d.notiz });
			zeilen.push({ label: n.titel, wert: d.notiz });
		} else warnungen.push('Der Leitfaden hat keinen Notiz-Schritt – die Notiz wird nicht gespeichert.');
	}
	if (eingaben.length === 0) return { fehlt: 'Ich habe nichts zum Eintragen verstanden (z. B. „E-Mail ist …“, „bevorzugt per WhatsApp“).', zeilen, warnungen, werte: {} };
	return { fehlt: null, zeilen, warnungen, werte: { einsatzId: ziel.einsatzId, eingaben } };
}
