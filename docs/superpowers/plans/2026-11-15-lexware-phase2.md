# Lexware Phase 2 (Angebot über Lexware, drei Terminvorschläge, Annahme → Lexware-Auftragsbestätigung) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Betriebe mit aktiver Lexware-Verbindung bekommen Angebote und Auftragsbestätigungen nur noch aus Lexware (Nummer, PDF, Festschreibung); das CRM bleibt die Oberfläche (Positionen, Kunde, Portal, Mail, Nachfassen). Angebote können drei Baubeginn-Termine vorschlagen; der Kunde wählt im Portal (oder das Büro bzw. die Sprache) einen Termin, der als Lexware-AB-Text, am Auftrag und als vorläufiger Einsatz in der Plantafel landet. Ohne Lexware-Verbindung bleibt alles wie bisher (CRM-Nummern AN-/AB-…, pdfkit).

**Architecture:** Jeder Lexware-Schritt läuft über die Warteschlange aus Phase 1 (`app.lexware_auftraege`, Idempotenz, Ratenlimit, „ungewiss“ + `vorhanden()`):
`angebot_festschreiben` (POST `/v1/quotations?finalize=true`) → `angebot_versand` (GET Beleg für Nummer, GET `/file` → PDF-Zwischenspeicher `app.lexware_dateien`, Portal-Freigabe, Mail über das CRM-Postfach oder Aufgabe „bereit zum Versand“) und nach der Annahme `ab_anlegen` (POST `/v1/order-confirmations?precedingSalesVoucherId=…&finalize=true`) → `ab_versand` (Nummer + PDF → `app.auftragsbestaetigungen` als Spiegel, Mail/Aufgabe, Aufgabe „Angebot in Lexware als angenommen markieren“ mit Deeplink). Die Datenbank erzwingt, dass ein Lexware-Betrieb keine CRM-Angebotsnummer mehr bekommt (Trigger) und dass ein festgeschriebenes Lexware-Angebot nie wieder Entwurf wird.

**Tech Stack:** SvelteKit 2, Svelte 5, PostgreSQL (RLS), postgres.js, vitest, Lexware-Attrappe (`tests/hilfe/lexware-attrappe.ts`).

**Spec:** `scratchpad/crm-plan-rechnungen.md` Abschnitte 1, 2 (§ 35a, § 13b), 3, 4, 6; Tasks T5, T6, T10. Freigabe/Antworten Jamil #6093: XL ja; Rechnung aus Angebot; Abschlag/Schluss über Deeplink; Mahnstufen einstellbar; Postfach kommt noch; § 35a + § 13b berücksichtigen; drei Terminvorschläge ja.

## Entscheidungen (mit Begründung)

1. **„Entwurf änderbar bis Versand“ = CRM-Entwurf, Lexware-Beleg erst beim Versand (festgeschrieben).** Die Lexware-API hat für Angebote weder Ändern (PUT) noch Löschen noch „Entwurf festschreiben“ (Doku „Quotations“: nur `POST [?finalize=true]`, GET, `/file`, Deeplinks; „The status cannot be changed through the API“). Ein früh angelegter Lexware-Entwurf müsste bei jeder Änderung im CRM neu angelegt werden und bliebe als Leiche in Lexware liegen (Plan Frage 5, Empfehlung). Deshalb: Positionen, Kunde, Texte und Termine bleiben bis zum Klick auf „Versenden“ im CRM änderbar (Anzeige „Entwurf (noch ohne Nummer)“, Vorschau-PDF mit Wasserzeichen „Vorschau – kein Beleg“); „Versenden“ (Rückfrage „danach nicht mehr änderbar“) legt **genau einen** festgeschriebenen Lexware-Beleg je Version an. Danach: „Neue Version“ = neues Lexware-Angebot.
2. **Schalter `belege_in_lexware`** in `app.lexware_konfig` (Standard an). Wirksam, sobald der Betrieb einmal erfolgreich verbunden war (`organisation_id` gesetzt) – auch wenn der Schlüssel später abläuft (die Aufträge warten dann in der Warteschlange, es entsteht kein zweiter Nummernkreis). Trigger `angebot_nummer_setzen` liest das (SECURITY DEFINER) und setzt `beleg_quelle = 'lexware'` ohne Nummer.
3. **Nummer:** `angebote.nummer` wird nullable; bei Lexware-Angeboten wird sie nach dem Festschreiben mit der Lexware-Nummer gefüllt (Check: `beleg_quelle = 'crm' or nummer is null or nummer = lexware_nummer`) – so funktionieren Suche, Portal, Mailvorlagen und Nachfassen unverändert.
4. **Altbelege:** CRM-Angebote (`beleg_quelle = 'crm'`) eines Lexware-Betriebs heißen „Altbeleg (CRM-Nummer)“: Entwürfe sind nicht mehr änderbar und nicht versendbar (409, „bitte ‚Neue Version‘“), versendete bleiben entscheidbar. Ihre Annahme erzeugt eine Lexware-AB **ohne** Vorgänger (volle Positionen) – nie eine CRM-AB-Nummer.
5. **Doppelbeleg nach Zeitüberschreitung:** Verkaufsbelege haben kein Notizfeld für eine Marke. `vorhanden()` sucht in `GET /v1/voucherlist` (Typ quotation bzw. orderconfirmation, Status any, `updatedDateFrom` = Tag des ersten Versuchs) einen Beleg mit derselben `contactId` (bzw. demselben `contactName`) und demselben Bruttobetrag, angelegt nach dem ersten Versuch; genau ein Treffer → übernehmen, mehrere → `pruefen` (Mensch entscheidet), keiner → neu anlegen.
6. **Kunde in Lexware:** Ist der Kunde noch nicht verknüpft, legt `angebot_festschreiben` ihn vorher an (erst Suche per Marke `CRM-Kunde <id>`, dann POST) – kein doppelter Kontakt bei Wiederholung. Einmal-Kunden ohne Kundenakte gehen als Adresse (`name`, `street`, `zip`, `city`, `countryCode`) ohne `contactId`.
7. **Steuer:** Kleinunternehmer (Profil `smallBusiness`) → `taxType: vatfree`, Satz 0. Firmenkunde mit § 13b (Bauleister, Bescheinigung gültig am Belegdatum) → `taxType: constructionService13b`, Satz 0 (Lexware druckt den Hinweis „Steuerschuldnerschaft des Leistungsempfängers“; Satz 0 im T0-Probelauf mit dem XL-Testkonto bestätigen). Sonst `net` mit dem MwSt-Satz des Angebots. Bescheinigung abgelaufen → Warnung am Angebot, Beleg normal mit USt.
8. **§ 35a EStG** (nur Privatkunden): Arbeitskosten je Position = (Einzelpreis − Materialanteil) × Menge, brutto mit MwSt. Fehlt bei einer Position der Materialanteil (freie Position ohne Katalog), wird **kein** Betrag geraten: Satz „Arbeitskosten … (ohne Position n – bitte prüfen)“ entfällt, stattdessen Warnung am Angebot und Text ohne Zahl. Text in `remark`: „Im Gesamtbetrag enthaltene Arbeitskosten nach § 35a EStG: x € (davon y € MwSt). Bitte überweisen Sie – Barzahlung ist nicht begünstigt.“ Angebot und AB tragen ihn (Rechnung folgt in Phase 3).
9. **Termine:** `app.angebot_terminvorschlaege` (pos 1–3, `beginn date`, `hinweis ≤ 200`), nur im Entwurf änderbar (Trigger wie Positionen), nur Tage ab morgen, von `neueVersion` mitkopiert. Text in `introduction`/`remark` des Lexware-Angebots; die CRM-Tabelle bleibt für das Portal maßgeblich. Wahl im Portal: Pflicht, wenn Vorschläge da sind (1/2/3 oder „keiner passt“ + Freitext). Gewählter Termin → `angebot_entscheidungen.termin_vorschlag_id`, `auftraege.baubeginn`, Lexware-AB-`introduction`, vorläufiger Einsatz „Baubeginn (reserviert)“ (07:00–16:00, Zuständiger) oder – ohne Zuständigen – Aufgabe; „keiner passt“ → Aufgabe „Kunden anrufen“.
10. **Mail:** neuer Mail-Zweck `angebot` (Vorlage „Angebot senden“). Mailversand eingerichtet → Lexware-PDF als Anhang (`Angebot_<Nr>.pdf`); sonst Aufgabe + Glocke „bereit zum Versand“ und am Angebot „PDF (Lexware) herunterladen“ / „In Mailprogramm öffnen“.
11. **Nachfassen:** zählt bei Lexware-Angeboten ab dem Versand (gesetzt erst nach Festschreiben + PDF) und stoppt zusätzlich, wenn Lexware „accepted“/„rejected“ meldet (Belegspiegel → `angebote.lexware_status`).

## Global Constraints

- Migration **121** (geprüft 15.11.: höchste auf allen Zweigen/Worktrees 120). Keine Migration in die Vorschau-DB, kein Vorschau-Neubau, `main` unverändert.
- RLS + `betrieb_id` überall, DB-Tests mit zwei Betrieben; Rechte wie bisher `angebote.bearbeiten` + `preise.sehen` (+ Sicht auf Aufträge).
- Lexware nur über die Warteschlange und die Attrappe in Tests (Formate nach developers.lexware.io, Quellen im Kommentar der Attrappe).
- Eingaben validieren (UUID, Datum, Längen), Lexware-Antworten sind Daten (IDs per UUID-Prüfung, Nummern ≤ 40 Zeichen, PDF ≤ 10 MB, `%PDF` geprüft); keine Secrets in Logs.
- STANDING RULE Sprachaktionen: `angebot_versenden` (Rückfrage), `neue_angebotsversion`, `terminvorschlaege_setzen`, `angebot_entscheidung` + `termin`.
- Funktionen/Neuigkeiten/ⓘ nachziehen.

## Tasks

### Task 1: Migration 121
- [x] `angebote`: `beleg_quelle crm|lexware`, `nummer` nullable + Check, `lexware_id/_nummer/_status/_version/_stand`, `lexware_fehler`; Trigger Nummer, Trigger „festgeschrieben bleibt versendet“.
- [x] `lexware_konfig.belege_in_lexware`; `app.lexware_beleg_modus(betrieb)` (SECURITY DEFINER, intern).
- [x] `app.lexware_dateien` (PDF-Zwischenspeicher, RLS), `auftragsbestaetigungen.lexware_id`, `beleg_quelle`.
- [x] `app.angebot_terminvorschlaege` + Trigger nur Entwurf; `angebot_entscheidungen.termin_vorschlag_id`, `termin_wunsch_text`; `auftraege.baubeginn`.
- [x] Mail-Zweck `angebot`.

### Task 2: Belegdaten für Lexware (rein, Unit-Tests)
`src/lib/server/lexware/belege.ts`: `lexwareDatum(tag)`, `steuerFall(...)`, `arbeitskosten35a(positionen, mwst)`, `termineText(termine)`, `angebotAlsLexware(...)`, `abAlsLexware(...)`.
- [x] Snapshot privat/firma, 13b, Kleinunternehmer, Termine, § 35a (mit/ohne Material), Längen (title 25, introduction/remark 2000, 300 Positionen).

### Task 3: Attrappe
- [x] `POST/GET /v1/quotations`, `/file`, `POST /v1/order-confirmations[?precedingSalesVoucherId]` (Entwurf/abgelehnt → 406), `/file`, Belegliste mit den neuen Belegen.

### Task 4: Angebot über Lexware (Server + DB-Tests)
`src/lib/server/lexware/angebote.ts`, Änderungen in `angebote.ts`, `kundenportal-oeffentlich.ts`, `auftragsbestaetigung.ts`, `nachfassen.ts`, `lexware/abgleich.ts`, `lexware/dienst.ts`, `warteschlange.ts`.
- [x] DB: Lexware-Betrieb → neue Angebote ohne CRM-Nummer; ohne Lexware unverändert AN-…
- [x] Versenden → ein POST mit finalize, Nummer + PDF gespeichert, Portal zeigt Lexware-PDF, Mail mit Anhang (Attrappe) bzw. Aufgabe.
- [x] Doppelklick → ein Auftrag; Zeitüberschreitung → ungewiss → kein zweites Angebot.
- [x] Festgeschrieben → zurück zum Entwurf abgelehnt; vor dem Festschreiben „Versand zurücknehmen“ möglich.
- [x] Neue Version → neuer Entwurf ohne Nummer, Termine kopiert; Altbeleg-Entwurf gesperrt.
- [x] Annahme → `ab_anlegen` mit `precedingSalesVoucherId`, AB-Spiegel mit Lexware-Nummer; Lexware nicht erreichbar → Annahme gespeichert, AB kommt nach.
- [x] Nachfassen stoppt bei Lexware-Status accepted/rejected.

### Task 5: Terminvorschläge (Server + DB-Tests)
- [x] Setzen (max 3, Zukunft, nur Entwurf), Text im Lexware-Beleg, Portal-Annahme ohne Wahl → 400, Wahl → Auftrag `baubeginn`, Einsatz reserviert, AB-Text; „keiner passt“ → Aufgabe.

### Task 6: Oberfläche
- [x] Angebot: Lexware-Kasten (Stand, Nummer, Fehler, „In Lexware öffnen“, PDF, Mailprogramm), Versenden mit Rückfrage, Termine-Editor, Altbeleg-Hinweis; Portal: Terminwahl; Lexware-Einstellungsseite: Schalter `belege_in_lexware` mit ⓘ.

### Task 7: Sprachaktionen + Funktionen/Neuigkeiten
- [x] Fake-KI, Anweisungen, Schemas, Rechte, Auflösen, Ausführen, Tests.

### Task 8: Prüfen, commit, push
- [x] `npm test`, betroffene `test:db`, `npm run check`, `npm run build`; commit auf `lexware`, push.

## Nicht in Phase 2 (folgen)
Rechnungen (T7), Zahlungsstand (T8), Mahnungen (T9), Abschlag/Schluss per Deeplink, Umschaltanleitung/Probelauf mit Testkonto (T11), Gesamtprüfung (T12), E2E-Kette mit Attrappe.

## Stand 15.11.2026 (umgesetzt, Branch `lexware`)

- Tests: Unit 676/676, DB 1004 (Gesamtlauf; 2 Zeitüberschreitungen in `kundenportal.test.ts` nur durch parallelen Build, einzeln grün), neue Suite `tests/db/lexware-angebote.test.ts` 12/12, `npm run check` 0 Fehler, `npm run build` ok.
- Offen: Probelauf gegen ein echtes Lexware-XL-Testkonto (T0: § 13b mit Satz 0, setzt die AB das Angebot auf „accepted“?, App-Adresse für Deeplinks, PDF sofort nach dem Festschreiben verfügbar?); Anzeige `baubeginn` auf der Auftragsseite; E2E-Kette mit Attrappe; Installationspaket-Probelauf mit Migration 121.
