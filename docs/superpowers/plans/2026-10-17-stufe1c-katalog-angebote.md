# CRM System – Stufe 1c „Leistungskatalog, Angebote, PDF“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Betrieb pflegt seinen Leistungskatalog (mit Startvorlagen für Bad/Sanitär, Fliesen, Maler, Trockenbau), erstellt zu einem Auftrag Angebote aus Katalog- und freien Positionen und lädt sie als PDF mit eigenem Logo und Briefkopf herunter. Wer das Recht `preise.sehen` nicht hat (Monteur), bekommt nachweislich nirgends Preise.

**Architecture:** Bauweise wie 1a/1b (Migration mit RLS + Protokoll, Dienst `src/lib/server/<bereich>.ts`, dünne API, Seiten unter `(app)`). Geldbeträge sind ganzzahlige Cent (`bigint` in der DB, `number` im Code, nie Gleitkomma beim Rechnen). PDF serverseitig mit `pdfkit` und eingebetteter Schrift (Umlaute, €). Das Logo liegt als `bytea` im Betriebsprofil (RLS), nicht im Dateisystem.

**Tech Stack:** wie 1b; neu: `pdfkit` 0.15.x (+ `@types/pdfkit`), Schrift „Noto Sans“ Regular/Bold (OFL) als TTF unter `static/schriften/` bzw. `src/lib/server/pdf/schriften/`.

**Spec:** `docs/spec/pflichtenheft-v1.1.html` – Abschnitt 5 (Leistungskatalog: Position, Einheit, Lohn, Material, Gewerk-Vorlage; Angebot + Angebotspositionen), Abschnitt 6 Stufe 1 Zeilen „Leistungskatalog“ („Eigene Positionen, Startvorlagen für mindestens Bad/Sanitär, Fliesen, Maler, Trockenbau“), „Angebote + KI“ (nur der PDF-Teil; der KI-Entwurf folgt in Plan 1d) und „Rollen“ („Ein Monteur sieht nachweislich keine Preise“); Abschnitt 4 (KI darf später nur Katalogpositionen wählen, Preise kommen immer aus dem Katalog → die Datenstruktur hier muss das tragen).

Voraussetzung: Plan 1b ist umgesetzt (Aufträge mit Statuskette `anfrage` … `abgerechnet`, `src/lib/auftrag-status.ts`, `src/lib/zeit.ts`).

## Global Constraints

- Alle Global Constraints aus Plan 1a und 1b gelten.
- Module: Katalog = `katalog`, Angebote und PDF = `angebote` (aus `src/lib/tarife.ts`).
- Rechte (bestehend, keine neuen): Katalog lesen = `katalog.bearbeiten` **oder** `angebote.bearbeiten`; Katalog ändern = `katalog.bearbeiten`; Angebote lesen/ändern/PDF = `angebote.bearbeiten` **und** `preise.sehen`; Briefkopf/Logo = `einstellungen`.
- Ohne `preise.sehen` liefert **keine** API und **keine** Seite Preisfelder (`lohnCent`, `materialCent`, `einzelpreisCent`, Summen) – Felder fehlen, nicht `null`.
- Geld: Cent als ganze Zahl; Positionssumme = `round(menge × einzelpreisCent)` (kaufmännisch, 0,5 auf), Netto = Summe der Positionssummen, MwSt = `round(netto × satz / 100)`, Brutto = Netto + MwSt. MwSt-Satz je Angebot (Standard 19, erlaubt 0, 7, 19). Menge mit bis zu 3 Nachkommastellen (`numeric(12,3)`).
- Anzeige: `de-DE`, z. B. „1.234,56 €“, Mengen „2,5 m²“.
- Nummernkreis Angebote: `AN-<Jahr>-0001`, je Betrieb und Jahr (gleiches Verfahren wie Aufträge in 1b).
- Angebotsstatus (exakt): `entwurf` „Entwurf“, `versendet` „Versendet“, `angenommen` „Angenommen“, `abgelehnt` „Abgelehnt“. Nur `entwurf` ist änderbar; Positionen eines versendeten Angebots sind eingefroren (Kopie „Als neue Version bearbeiten“ legt ein neues Angebot im Entwurf an).
- Kopplung an den Auftrag: Angebot → `versendet` setzt den Auftrag von `anfrage` auf `angebot`; Angebot → `angenommen` setzt ihn von `angebot` auf `beauftragt`. In allen anderen Auftragsstatus bleibt der Auftrag unverändert.
- Logo: PNG oder JPEG, höchstens 1 MB, geprüft an den ersten Bytes (nicht an Dateiname/Typ-Angabe); höchstens 1500 × 1500 px.

## Review Focus

1. Menge 0, negativ oder mit Komma als Eingabe („2,5“) → 0/negativ ergibt 400, „2,5“ wird als 2,5 gelesen – Test in Task 4.
2. Rundung: 3 × 33,33 € + 19 % MwSt → Netto 99,99 €, MwSt 19,00 €, Brutto 118,99 € (nicht 118,98/119,00) – Test in Task 1.
3. Sehr lange Positionstexte und 60 Positionen → PDF bricht sauber auf Folgeseiten um, Kopfzeile/Seitenzahl auf jeder Seite, Summenblock nie allein ohne Tabellenkopf – Test in Task 6.
4. Monteur ruft `/api/katalog`, `/api/angebote/…`, `/api/angebote/…/pdf` und die Auftragsdetails auf → 403 bzw. keine Preisfelder im JSON (rekursiv geprüft) – Test in Task 7.
5. Logo als umbenannte Textdatei („logo.png“ mit HTML-Inhalt) oder 5 MB → 400 mit klarer Meldung, altes Logo bleibt – Test in Task 3.

---

## File Structure

```
db/migrations/013_katalog_angebote.sql     # katalog_vorlagen (global), katalog_positionen, betrieb_profil, angebote, angebot_positionen, Nummernkreis
db/vorlagen/katalog-startvorlagen.sql      # Startvorlagen (von 013 eingebunden oder als 014_katalog_vorlagen_seed.sql)
src/lib/geld.ts                            # Cent-Rechnen und Formatieren (auch UI)
src/lib/angebot-status.ts                  # Status ohne Serverbezug
src/lib/server/katalog.ts, src/lib/server/betriebsprofil.ts, src/lib/server/angebote.ts
src/lib/server/pdf/angebot-pdf.ts, src/lib/server/pdf/schriften/NotoSans-{Regular,Bold}.ttf
src/lib/server/preisschutz.ts              # entferntPreise(obj) für Antworten ohne preise.sehen
src/routes/api/katalog/…, api/katalog/vorlagen/…, api/angebote/…, api/angebote/[id]/pdf/+server.ts, api/einstellungen/briefkopf/…
src/routes/(app)/katalog/…, (app)/angebote/…, (app)/einstellungen/briefkopf/…
src/lib/components/{PositionenEditor,KatalogSuche,Summenblock}.svelte
tests/unit/{geld,angebot-status,preisschutz}.test.ts, tests/db/{katalog,angebote,briefkopf,preisschutz}.test.ts, tests/unit/angebot-pdf.test.ts
```

---

### Task 1: Geld und Angebotsstatus (ohne Server)

**Files:** Create `src/lib/geld.ts`, `src/lib/angebot-status.ts`; Test `tests/unit/geld.test.ts`, `tests/unit/angebot-status.test.ts`

**Interfaces:**
- Produces:
  - `export function leseMenge(eingabe: string | number): number` – akzeptiert „2,5“, „2.5“, 2.5; max. 3 Nachkommastellen; wirft `RangeError` bei ≤ 0, NaN, > 1 000 000
  - `export function leseEuroInCent(eingabe: string | number): number` – „1.234,56“, „1234,56“, „1234.56“, 1234.56 → 123456; ≥ 0; max. 2 Nachkommastellen
  - `export function positionsSumme(menge: number, einzelpreisCent: number): number` – `Math.round` mit Korrektur gegen Gleitkommafehler (Rechnung in Tausendstel-Cent als ganze Zahl)
  - `export function summen(positionen: { menge: number; einzelpreisCent: number }[], mwstSatz: 0 | 7 | 19): { nettoCent: number; mwstCent: number; bruttoCent: number }`
  - `export function euro(cent: number): string` → „1.234,56 €“ (geschütztes Leerzeichen vor €)
  - `export const ANGEBOT_STATUS = ['entwurf','versendet','angenommen','abgelehnt'] as const; export type AngebotStatus; export const ANGEBOT_STATUS_NAMEN; export function istAngebotStatus(w): w is AngebotStatus; export function erlaubterAngebotWechsel(von, nach): boolean` – erlaubt: entwurf→versendet, versendet→angenommen, versendet→abgelehnt, versendet→entwurf

- [ ] **Step 1: Write the failing tests**
```ts
expect(summen([{ menge: 3, einzelpreisCent: 3333 }], 19)).toEqual({ nettoCent: 9999, mwstCent: 1900, bruttoCent: 11899 });
expect(positionsSumme(2.5, 4999)).toBe(12498);          // 124,975 → 124,98? nein: 12497,5 → 12498
expect(positionsSumme(0.1 * 3, 1000)).toBe(300);        // kein 299 durch Gleitkomma
expect(leseMenge('2,5')).toBe(2.5);
expect(() => leseMenge('0')).toThrow(RangeError);
expect(() => leseMenge('-1')).toThrow(RangeError);
expect(leseEuroInCent('1.234,56')).toBe(123456);
expect(euro(123456)).toBe('1.234,56 €');
expect(erlaubterAngebotWechsel('entwurf','angenommen')).toBe(false);
```
- [ ] **Step 2: Run** `sudo docker exec crm-dev sh -lc 'cd /work/crm && npx vitest run tests/unit/geld.test.ts tests/unit/angebot-status.test.ts'` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(1c): Geld-Rechnen und Angebotsstatus`

### Task 2: Migration Katalog, Briefkopf, Angebote + Startvorlagen

**Files:** Create `db/migrations/013_katalog_angebote.sql`, `db/migrations/014_katalog_vorlagen.sql`; Modify `src/lib/server/protokoll.ts`; Test `tests/db/katalog.test.ts` (Schema-Teil)

**Interfaces (SQL):**
- `app.katalog_vorlagen(id, gewerk text check in ('bad_sanitaer','fliesen','maler','trockenbau'), bezeichnung, beschreibung, einheit text check in ('Stk','m²','m','lfm','m³','h','psch','kg','l'))` – **gemeinsamer** Katalog ohne `betrieb_id` und **ohne Preise**, nur lesbar für `crm_app` (wie `app.tarife`); 014 füllt je Gewerk 10–15 typische Positionen (z. B. Bad: „Demontage Altbad“, „Bodengleiche Dusche einbauen“, „WC wandhängend inkl. Vorwandelement montieren“; Fliesen: „Bodenfliesen verlegen bis 60×60“, „Abdichtung im Verbund“; Maler: „Wände streichen Dispersion 2×“, „Spachteln Q3“; Trockenbau: „Ständerwand einfach beplankt“, „Decke abhängen“), idempotent per `on conflict do nothing` mit festem Schlüssel `(gewerk, bezeichnung)`.
- `app.katalog_positionen(id, betrieb_id, gewerk text null, nummer text null ≤ 20, bezeichnung text not null 1–200, beschreibung ≤ 2000, einheit text not null (gleiche Liste), lohn_cent bigint not null default 0 check ≥ 0, material_cent bigint not null default 0 check ≥ 0, aktiv boolean default true, vorlage_id uuid null, angelegt, geaendert, unique(id,betrieb_id), unique(betrieb_id, vorlage_id))` – Einzelpreis = Lohn + Material.
- `app.betrieb_profil(betrieb_id uuid pk, firmenname, strasse, plz, ort, telefon, email, web, steuernummer, ust_id, iban, bic, bank, fusszeile ≤ 500, logo bytea null, logo_typ text null check in ('image/png','image/jpeg'), geaendert)` – RLS über `betrieb_id`.
- `app.angebote(id, betrieb_id, nummer, auftrag_id not null, status default 'entwurf', datum date not null default Berlin-heute, gueltig_bis date not null, mwst_satz smallint not null default 19 check in (0,7,19), einleitung ≤ 2000, schluss ≤ 2000, vorgaenger_id uuid null, angelegt, geaendert, unique(id,betrieb_id), unique(betrieb_id,nummer), fk (auftrag_id,betrieb_id)→auftraege, fk (vorgaenger_id,betrieb_id)→angebote, check (gueltig_bis >= datum))`; Nummernkreis-Tabelle + Funktion `app.naechste_angebotsnummer(p_betrieb uuid)` analog 1b (`AN-2026-0001`).
- `app.angebot_positionen(id, betrieb_id, angebot_id, pos smallint not null, katalog_position_id uuid null, bezeichnung not null 1–200, beschreibung ≤ 2000, menge numeric(12,3) not null check > 0, einheit, einzelpreis_cent bigint not null check ≥ 0, unique(angebot_id, pos) deferrable initially deferred, fk (angebot_id,betrieb_id)→angebote on delete cascade, fk (katalog_position_id,betrieb_id)→katalog_positionen on delete set null)` – Preis wird beim Übernehmen **kopiert** (spätere Katalogänderung ändert kein Angebot).
- Trigger: Änderungen an Positionen/Kopf nur im Status `entwurf` (sonst Fehler `55000` „Angebot ist nicht mehr änderbar“), `setze_geaendert`, `protokolliere('geaendert','logo')` (Logo-Bytes nie ins Protokoll).
- RLS ENABLE + FORCE auf allen Betriebstabellen; Spaltenrechte wie 007.
- `PROTOKOLL_TABELLEN`: `katalog_positionen: 'katalog.bearbeiten'`, `angebote: 'angebote.bearbeiten'`, `angebot_positionen: 'angebote.bearbeiten'`, `betrieb_profil: 'einstellungen'`; `PROTOKOLL_MODULE` entsprechend `katalog`/`angebote`.

- [ ] **Step 1: Write the failing tests:** RLS (Betrieb B sieht/ändert nichts von A); Nummern `AN-<Jahr>-0001/0002` je Betrieb; Position in versendetem Angebot ändern → 55000; Vorlagen je Gewerk ≥ 10 und ohne Preisfelder; Logo-Bytes erscheinen nicht in `app.aenderungen`.
- [ ] **Step 2: Run** `npx vitest run tests/db/katalog.test.ts` → FAIL
- [ ] **Step 3: Write migrations**
- [ ] **Step 4: Run** → PASS; `npm run test:db` komplett grün
- [ ] **Step 5: Commit** `feat(1c): Migration Katalog, Briefkopf, Angebote, Startvorlagen`

### Task 3: Briefkopf und Logo

**Files:** Create `src/lib/server/betriebsprofil.ts`, `src/routes/api/einstellungen/briefkopf/+server.ts`, `src/routes/api/einstellungen/briefkopf/logo/+server.ts`, `src/routes/(app)/einstellungen/briefkopf/+page.{server.ts,svelte}`; Modify `src/lib/navigation.ts` (Mehr: „Briefkopf“ mit `einstellungen`); Test `tests/db/briefkopf.test.ts`

**Interfaces:**
- `holeProfil(k): Promise<Profil>` (ohne Logo-Bytes, mit `hatLogo: boolean`), `speichereProfil(k, e): Promise<Profil>` (Längen wie Spalten, E-Mail/IBAN-Format grob geprüft: IBAN 15–34 alphanumerisch ohne Leerzeichen gespeichert), `speichereLogo(k, bytes: Uint8Array): Promise<void>` (400 `Bitte ein PNG- oder JPEG-Bild bis 1 MB hochladen`, Größe aus PNG-IHDR bzw. JPEG-SOF gelesen, > 1500 px → 400), `holeLogo(k): Promise<{ bytes: Uint8Array; typ: string } | null>`, `loescheLogo(k)`.
- Seite: Formular Briefkopf + Logo-Upload (multipart, `accept="image/png,image/jpeg"`), Vorschau des Logos über `GET /api/einstellungen/briefkopf/logo` (nur `einstellungen` oder `angebote.bearbeiten`).

- [ ] **Step 1: Write the failing tests:** echtes kleines PNG (im Test erzeugt) → ok, `hatLogo` true; Textdatei mit `.png`-Inhalt `<html>` → 400, vorhandenes Logo bleibt; 1 048 577 Bytes → 400; PNG 2000×10 → 400; Büro ohne `einstellungen` → 403.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(1c): Briefkopf und Logo`

### Task 4: Leistungskatalog – Dienst, API, Seiten, Vorlagen übernehmen

**Files:** Create `src/lib/server/katalog.ts`, `src/routes/api/katalog/+server.ts`, `api/katalog/[id]/+server.ts`, `api/katalog/vorlagen/+server.ts` (GET Liste je Gewerk, POST `{ gewerk }` übernimmt alle noch nicht übernommenen Vorlagen dieses Gewerks mit Preis 0), `src/routes/(app)/katalog/+page.*`, `(app)/katalog/[id]/+page.*`, `(app)/katalog/neu/+page.*`, `src/lib/components/KatalogSuche.svelte`; Modify `src/lib/navigation.ts` (Haupt oder Mehr: „Katalog“, Modul `katalog`, Recht wie Global Constraints); Test `tests/db/katalog.test.ts`

**Interfaces:**
- `export type KatalogPosition = { id; gewerk: string|null; nummer: string|null; bezeichnung; beschreibung: string|null; einheit; aktiv: boolean; vorlageId: string|null; lohnCent?: number; materialCent?: number; einzelpreisCent?: number }` (Preisfelder nur mit `preise.sehen`)
- `listeKatalog(k, { suche?, gewerk?, nurAktive? }, mitPreisen: boolean)`, `holePosition`, `legePositionAn`, `aenderePosition`, `deaktivierePosition` (kein hartes Löschen, wenn in Angeboten verwendet → `aktiv=false`), `uebernimmVorlagen(k, gewerk): Promise<{ neu: number }>`
- Seite Katalog: Suche, Filter Gewerk, Liste mit Einheit und Preis (Preis 0 gelb „Preis fehlt“), Knopf „Startvorlage übernehmen“ (Bad/Sanitär, Fliesen, Maler, Trockenbau) mit Anzahl neuer Positionen.

- [ ] **Step 1: Write the failing tests:** Vorlage „fliesen“ zweimal übernehmen → beim zweiten Mal `neu: 0`; Eingabe „2,5“/„1.234,56“ korrekt gelesen (über `leseEuroInCent`); Preis negativ → 400; Position in Angebot verwendet → Löschen setzt `aktiv=false`; Büro (alle Rechte außer Einstellungen) liest mit Preisen; Benutzer mit `angebote.bearbeiten` ohne `preise.sehen` liest ohne Preisfelder (`'lohnCent' in p === false`).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS; `npm run check` 0 Fehler
- [ ] **Step 5: Commit** `feat(1c): Leistungskatalog mit Startvorlagen`

### Task 5: Angebote – Dienst und API

**Files:** Create `src/lib/server/angebote.ts`, `src/routes/api/angebote/+server.ts` (GET `?auftrag=`, POST `{ auftragId }`), `api/angebote/[id]/+server.ts` (GET, PATCH Kopf, DELETE nur Entwurf), `api/angebote/[id]/positionen/+server.ts` (PUT ganze Positionsliste), `api/angebote/[id]/status/+server.ts` (POST `{ status }`), `api/angebote/[id]/neue-version/+server.ts` (POST); Test `tests/db/angebote.test.ts`

**Interfaces:**
- `export type Angebot = { id; nummer; auftragId; auftragNummer; kundeName; status: AngebotStatus; datum; gueltigBis; mwstSatz: 0|7|19; einleitung; schluss; positionen: AngebotPosition[]; nettoCent; mwstCent; bruttoCent; vorgaengerId: string|null; warnungen: ('preis_fehlt')[] }`, `AngebotPosition = { id; pos; katalogPositionId: string|null; bezeichnung; beschreibung; menge; einheit; einzelpreisCent; summeCent }`
- `legeAngebotAn(k, auftragId)` – Kopf mit `gueltig_bis = datum + 30 Tage`, Einleitung „Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:“ und Schluss „Wir freuen uns auf Ihren Auftrag.“ (änderbar)
- `speicherePositionen(k, id, positionen: { katalogPositionId?: string; bezeichnung?: string; beschreibung?: string; menge: string|number; einheit?: string; einzelpreis?: string|number }[])` – Katalogposition: Bezeichnung/Einheit/Preis werden aus dem Katalog **kopiert**, wenn nicht ausdrücklich überschrieben; `pos` = Reihenfolge 1…n; max. 200 Positionen
- `setzeAngebotStatus(k, id, nach)` inkl. Auftragskopplung (Global Constraints) in **derselben** Transaktion; `neueVersion(k, id)` kopiert Kopf + Positionen in einen neuen Entwurf (`vorgaenger_id`)
- Alle Endpunkte: `darf(locals,'angebote','angebote.bearbeiten')` **und** `pruefeRecht(locals,'preise.sehen')`.

- [ ] **Step 1: Write the failing tests:** Summen aus Positionen (3 × 33,33 € → 99,99/19,00/118,99); Katalogpreis wird kopiert und bleibt nach Katalogänderung gleich; Status `entwurf→angenommen` 409; `versendet` setzt Auftrag `anfrage→angebot`, `angenommen` setzt `angebot→beauftragt`, Auftrag in `in_arbeit` bleibt unverändert; PATCH in versendetem Angebot → 409 „Angebot ist nicht mehr änderbar“; `neueVersion` liefert neuen Entwurf mit `vorgaengerId`; 201 Positionen → 400; `warnungen` enthält `preis_fehlt`, wenn eine Position 0 € kostet.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(1c): Angebote mit Positionen und Statuskopplung`

### Task 6: Angebots-PDF

**Files:** Create `src/lib/server/pdf/angebot-pdf.ts`, `src/lib/server/pdf/schriften/NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` (+ `LIZENZ-OFL.txt`), `src/routes/api/angebote/[id]/pdf/+server.ts`; Modify `package.json` (`pdfkit`, `@types/pdfkit`); Test `tests/unit/angebot-pdf.test.ts`

**Interfaces:**
- `export async function angebotPdf(daten: { profil: Profil; logo: { bytes: Uint8Array; typ: string } | null; angebot: Angebot; kunde: { name: string; strasse: string|null; plz: string|null; ort: string|null }; objekt: { bezeichnung: string; strasse; plz; ort } | null }, opts?: { komprimieren?: boolean }): Promise<Uint8Array>`
- Layout A4: oben rechts Logo (max. 45 × 25 mm, Seitenverhältnis), links Absenderzeile + Empfängeradresse (Fensterposition DIN 5008 Form B), rechts Angebotsnummer, Datum, gültig bis, Auftragsnummer, ggf. Bauvorhaben/Objekt; Titel „Angebot AN-…“; Einleitung; Tabelle Pos | Bezeichnung (+ Beschreibung klein) | Menge | Einheit | Einzelpreis | Gesamt; Summenblock Netto / MwSt x % / Brutto; Schlusstext; Fußzeile aus Profil (Firma, Adresse, Kontakt, Steuernr./USt-ID, Bank/IBAN) auf jeder Seite, Seitenzahl „Seite x von y“; Seitenumbruch wiederholt Tabellenkopf; Summenblock rutscht mit mindestens einer Positionszeile auf die neue Seite.
- Dateiname: `Angebot_AN-2026-0001.pdf` (`Content-Disposition: attachment`), `Cache-Control: no-store`.
- Ein Angebot mit Warnung `preis_fehlt` erzeugt das PDF trotzdem; die Oberfläche fragt vorher nach (Task 8).

- [ ] **Step 1: Write the failing tests** (mit `komprimieren: false`, damit Text im PDF-Strom suchbar ist): Ergebnis beginnt mit `%PDF-`; enthält „Angebot AN-2026-0001“, „Müller“, „118,99“; 60 Positionen mit langen Texten → `/Type /Page` mindestens 3-mal und „Seite 3 von“ vorhanden; ohne Logo kein Fehler; mit PNG-Logo enthält das PDF `/Subtype /Image`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/angebot-pdf.test.ts` → FAIL
- [ ] **Step 3: Install** `npm i pdfkit@0.15 && npm i -D @types/pdfkit` (im Container), Schriften aus dem offiziellen Noto-Repository (OFL) einchecken, implementieren.
- [ ] **Step 4: Run** → PASS; `npm run build` ok (Schriften werden im Build gefunden: Pfad über `new URL('./schriften/…', import.meta.url)` bzw. in `static/` und zur Laufzeit gelesen – im Build prüfen)
- [ ] **Step 5: Commit** `feat(1c): Angebots-PDF mit Logo und Briefkopf`

### Task 7: Preisschutz rundum

**Files:** Create `src/lib/server/preisschutz.ts`; Modify Antworten in `api/auftraege/**`, `api/katalog/**` (nur falls nötig); Test `tests/unit/preisschutz.test.ts`, `tests/db/preisschutz.test.ts`

**Interfaces:**
- `export const PREISFELDER = ['lohnCent','materialCent','einzelpreisCent','summeCent','nettoCent','mwstCent','bruttoCent'] as const`
- `export function enthaeltPreisfeld(wert: unknown): boolean` – rekursiv über Objekte/Arrays
- `export function ohnePreise<T>(wert: T): T` – entfernt die Felder rekursiv (Sicherheitsnetz für Antworten an Benutzer ohne `preise.sehen`)

- [ ] **Step 1: Write the failing tests:** Unit für beide Funktionen; DB/API: Monteur (`kunden.lesen`, `auftraege.lesen`) ruft `GET /api/katalog`, `GET /api/angebote?auftrag=…`, `GET /api/angebote/[id]`, `GET /api/angebote/[id]/pdf` → 403; `GET /api/auftraege/[id]` (eigener Auftrag mit Angebot) → 200 und `enthaeltPreisfeld(json) === false`; Rolle „Büro ohne Preise“ (alle Rechte außer `preise.sehen`) → Katalog ohne Preisfelder, Angebote 403.
- [ ] **Step 2: Run** → FAIL (bzw. grün, wo schon richtig – dann bleibt der Test als Absicherung)
- [ ] **Step 3: Implement** wo nötig (Auftragsdetail zeigt Angebote nur als Nummer/Status, Beträge nur mit `preise.sehen`).
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `test(1c): Preisschutz für Rollen ohne „Preise sehen“`

### Task 8: Angebots-Oberfläche

**Files:** Create `src/routes/(app)/angebote/+page.*` (Liste, Filter Status), `(app)/angebote/[id]/+page.*` (Editor), `src/lib/components/PositionenEditor.svelte`, `src/lib/components/Summenblock.svelte`; Modify `(app)/auftraege/[id]/+page.*` (Bereich „Angebote“ mit „Angebot erstellen“, nur mit Rechten), `src/lib/navigation.ts` (Haupt: „Angebote“, Modul `angebote`, Rechte `angebote.bearbeiten` + `preise.sehen`); Test `tests/unit/navigation.test.ts` (Ergänzung), `tests/e2e/angebote.spec.ts`

- Editor: Kopf (Datum, gültig bis, MwSt-Satz, Einleitung, Schluss), Positionen als Karten (mobil) bzw. Tabelle (≥ 700 px): „+ Aus Katalog“ (KatalogSuche mit Gewerk-Filter), „+ Freie Position“, Menge/Einzelpreis direkt editierbar (Komma-Eingabe), Verschieben hoch/runter (Knöpfe, keine Ziehgeste nötig), Entfernen; Summenblock live (`summen()` aus Task 1, Server rechnet beim Speichern verbindlich nach); Speichern = `PUT …/positionen`; Knöpfe „PDF herunterladen“ (bei `preis_fehlt` vorher Bestätigung „1 Position ohne Preis – trotzdem erstellen?“), „Als versendet markieren“, „Angenommen“/„Abgelehnt“, „Als neue Version bearbeiten“; versendete Angebote nur lesend mit Hinweis.
- Navigation exakt: Chef/Büro sehen „Angebote“ (Haupt) und „Katalog“ (Mehr) und „Briefkopf“ (Mehr, nur `einstellungen`); Monteur nichts davon.

- [ ] **Step 1: Write the failing tests:** Navigation-Unit wie oben; E2E (Vorschau mit Seed, 390 × 844 und 1280 × 800): Chef öffnet Auftrag → „Angebot erstellen“ → 2 Katalogpositionen + 1 freie → Summe sichtbar „… €“ → PDF-Download liefert `application/pdf` mit > 5 kB → „Als versendet markieren“ → Auftrag zeigt Status „Angebot“; Monteur sieht im Auftrag keinen Bereich „Angebote“ und keine €-Beträge (`page.content()` enthält kein „€“).
- [ ] **Step 2: Run** Unit → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** Unit + `npm run check` → PASS
- [ ] **Step 5: Commit** `feat(1c): Angebots-Editor und Navigation`

### Task 9: Testdaten, Gesamtprüfung, Abnahme-Fotos

**Files:** Modify `scripts/seed-dev.ts` (Bauwelt-Briefkopf mit Firmendaten aus der Bauwelt-Website: „Bauwelt Handwerk GmbH“, Norderstedt – nur Felder, die öffentlich auf deren Website stehen; Logo-Datei `scripts/seed-dateien/bauwelt-logo.png` aus `/home/can/projekte/Bauwelt/public/assets/logo.png`; Startvorlagen Bad + Fliesen übernommen und mit Beispielpreisen versehen, als „Beispielpreis“ in der Beschreibung gekennzeichnet; 2 Angebote: ein Entwurf, ein versendetes), `tests/e2e/bildschirmfotos.spec.ts` (Katalog, Angebots-Editor Handy/PC, erste PDF-Seite als PNG), `README.md`; Test `tests/db/seed.test.ts` (idempotent)

- [ ] **Step 1: Write the failing test:** zweiter Seed-Lauf legt keine Katalogpositionen/Angebote doppelt an.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** komplette Suite (`npm run check && npm test && npm run test:db`), Vorschau neu bauen (Befehl aus Plan 1b Task 9), E2E inkl. `angebote.spec.ts` → grün; Fotos nach `scratchpad/crm-1c-fotos/`.
- [ ] **Step 5: Commit** `feat(1c): Testdaten, Abnahme-Fotos, README`
