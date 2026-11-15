# Lexware Phase 3 (Rechnungen, Zahlungsstand, Zahlungserinnerung und Mahnung) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus dem angenommenen Angebot bzw. der Auftragsbestätigung entsteht per Dialog am Auftrag eine Lexware-Rechnung (Standard: Entwurf, Festschreiben in Lexware). Das CRM spiegelt Nummer, PDF und Zahlungsstand (offen, teilweise bezahlt, bezahlt, überfällig, Teilzahlungen), zeigt alles am Auftrag, in der Kundenakte, unter „Ausgangsbelege → Rechnungen“ (Filter) und als Startseiten-Kachel. Nach der Fälligkeit greifen je Betrieb einstellbare Mahnstufen (Anzahl, Tage, Gebühr, Pauschale, Zinshinweis, Freigabe, Texte): Stufe 0 = Zahlungserinnerung (Aufgabe + vorbereitete Mail), Stufe 1–3 = Mahnung per Lexware-API (`POST /v1/dunnings?precedingSalesVoucherId=…`), PDF aus Lexware, Mail auf Klick. Abschlags- und Schlussrechnungen bereitet das CRM vor (Beträge/Positionen) und öffnet Lexware per Deeplink („In Lexware fertigstellen“); der Abgleich ordnet sie danach zu.

**Architecture:** Neue Tabelle `app.rechnungen` = jede Rechnung, die das CRM kennt (im CRM angestoßen oder beim Abgleich in Lexware gefunden), mit Auftrag/Angebot/Kunde, Dialog-Snapshot und Phase (`vorbereitet` → `wartet` → `angelegt`/`fehler`). Lexware-Daten (Nummer, Status, Fälligkeit, Beträge) bleiben im Spiegel `app.lexware_belege` (+ `bezahlt_am`, `zahlungen` jsonb aus `GET /v1/payments/{id}`), verknüpft über `lexware_id`. Warteschlange (Phase 1): `rechnung_anlegen` (anlegend, POST /v1/invoices?precedingSalesVoucherId={AB|Angebot}[&finalize=true]) → `rechnung_holen` (GET Beleg → Spiegel, PDF bei festgeschrieben, Aufgabe „in Lexware prüfen und festschreiben“ bzw. „an den Kunden senden“) · `zahlung_holen` (GET /v1/payments/{id}) · `mahnung_anlegen` (anlegend, POST /v1/dunnings) → `mahnung_versand` (/file → Zwischenspeicher, Aufgabe + Mail). Mahn-Engine wie Nachfassen 050 (`nachfass_laeufe` mit `rechnung_id`), Basis ist die gespiegelte Fälligkeit.

**Tech Stack:** SvelteKit 2, Svelte 5, PostgreSQL (RLS), postgres.js, vitest, Lexware-Attrappe.

**Spec:** `scratchpad/crm-plan-rechnungen.md` Abschnitte 1–4, T7–T9; Jamil #6086/#6088/#6090/#6093.

## Entscheidungen (mit Begründung)

1. **Immer `precedingSalesVoucherId`, eigene Positionen.** Die Rechnung verweist in Lexware auf die AB (sonst das Angebot); die Positionen kommen aus dem Dialog (Mengen laut Aufmaß, Haken weg = Teilrechnung). So bleibt die Belegkette in Lexware erhalten, und Abweichungen vom Angebot sind trotzdem möglich. Altbelege ohne Lexware-Vorgänger → ohne Parameter.
2. **Standard Entwurf** (Frage 4): `finalize` nur mit Haken „gleich festschreiben“. Entwurf → Aufgabe „Rechnung in Lexware prüfen und festschreiben“ mit Deeplink; die Rückmeldung `invoice.status.changed` (bzw. der nächtliche Abgleich) erkennt das Festschreiben → Aufgabe „Rechnung … an den Kunden senden“.
3. **Mail immer auf Klick** (Frage 12): Rechnung, Erinnerung und Mahnung gehen erst mit „Senden“ (CRM-Postfach, PDF direkt vorher frisch aus Lexware) bzw. „Mailprogramm“ + „Als gesendet markieren“.
4. **Doppelbeleg:** Dialog-Doppelklick → 409 (läuft schon eine Rechnung dieses Auftrags an). Zeitüberschreitung → `ungewiss` → `vorhanden()` sucht in der Belegliste (Typ invoice, gleicher Kontakt + Brutto, angelegt seit dem ersten Versuch), wie Phase 2. Mahnungen tauchen laut Doku **nicht** in der Belegliste auf → `mahnung_anlegen` gilt bei Zeitüberschreitung als `pruefen` (Mensch prüft in Lexware), nie blind ein zweites Mal.
5. **Zahlstatus (rein, `src/lib/rechnungen.ts`):** voided → storniert; draft → Entwurf; paid/paidoff oder offen 0 → bezahlt; overdue oder Fälligkeit < heute → überfällig (mit „teilweise bezahlt“, wenn offen < brutto); offen < brutto → teilweise bezahlt; sonst offen. Zahlungen erfasst nur Lexware (Bankabgleich, Frage 10).
6. **Mahnstufen** liegen weiter in `app.nachfass_stufen` (Art `rechnung`) und bekommen `gebuehr_cent`, `pauschale_firma` (40 € § 288 Abs. 5 BGB nur Firmen), `zinsen_hinweis`, `freigabe`. Eigene Einstellungsseite „Mahnungen“ (Recht `mahnungen.verwalten`), Nachfassen-Seite nur noch für Angebote. Basiszins und Zahlungsziel je Betrieb in `app.mahn_konfig`. **Verzugszinsen nur als Hinweis** (CRM-Anzeige und Mail-Platzhalter `{{zinsen}}`, nie als Lexware-Position). Mahngebühr/Pauschale als Positionen der Lexware-Mahnung (Satz 0 %, kein Entgelt).
7. **Stopp bei Zahlung:** Lauf und `zahlung_holen` erledigen offene Mahn-Aufgaben, sobald offen = 0, bezahlt oder storniert; `mahnung_anlegen` prüft vor dem POST erneut den Zahlungsstand. Pause je Rechnung (`mahnen_pausiert_bis`), „kein Nachfassen“ beim Kunden gilt auch hier. Stufe mit `freigabe` (Standard: 3. Mahnung) legt nur „Mahnung freigeben“ an.
8. **Abschlag/Schluss:** Dialog-Art „Abschlag“ (Betrag in € oder % vom Auftrag) bzw. „Schluss“ (Gesamt − gespiegelte Abschläge) → `phase = 'vorbereitet'` mit Betrag und Positionen zum Kopieren und Knopf „In Lexware fertigstellen“ (Deeplink auf AB bzw. Angebot). Der Abgleich ordnet neue `downpaymentinvoice`/`invoice` desselben Kunden mit gleichem Brutto (±1 ct) zu, sonst entsteht eine Zeile „aus Lexware“ beim Kunden.
9. **Rechte:** `rechnungen.sehen` (Liste, Status, PDF; Beträge zusätzlich nur mit `preise.sehen`), `rechnungen.erstellen` (Dialog, Senden, Festschreiben-Option), `mahnungen.verwalten` (Mahnstufen, Freigabe, Pause). Chef und Büro bekommen alle drei, Monteur keins (sieht nie Beträge). Migration ergänzt bestehende Rollen mit `angebote.bearbeiten` + `preise.sehen`.
10. **Pflichttexte in `remark`** (nur Privatkunden): § 35a-Arbeitskosten (ohne Raten, wie Phase 2), Verzugshinweis § 286 Abs. 3 BGB, Aufbewahrung 2 Jahre (§ 14 Abs. 4 Nr. 9 UStG). § 13b/Kleinunternehmer über `taxConditions` wie bei Angebot/AB. Leistungszeitraum über `shippingConditions` (`service` bzw. `serviceperiod`), Zahlungsziel über `paymentConditions.paymentTermDuration`.

## Global Constraints

- Migration **122** (höchste bisher 121). Keine Migration in die Vorschau-DB, kein Vorschau-Neubau, `main` unverändert.
- RLS + `betrieb_id` überall; DB-Tests mit zwei Betrieben. Lexware nur über die Warteschlange, feste Adresse, in Tests die Attrappe (Formate nach developers.lexware.io, Quellen im Kommentar).
- Beträge in Cent (bigint), Lexware-Dezimalzahlen → `Math.round(x*100)`. Eingaben validieren (UUID, Datum, Mengen 0–999999, Tage 0–120). Keine Secrets in Logs.
- STANDING RULE Sprachaktionen: `rechnung_erstellen` (Rückfrage), `rechnung_senden` (Rückfrage), `abfrage_offene_rechnungen` (`filter` offen|ueberfaellig|alle), `abfrage_zahlstatus` („Hat Kunde X bezahlt?“), `mahnung_pausieren` (bis Datum).
- Funktionen/Neuigkeiten/ⓘ, Menü (Gruppe „Abschluss & danach“: „Mahnungen“).

## Tasks

### Task 1: Migration 122
- [x] `app.rechnungen` (+ RLS, Grants), `lexware_belege.bezahlt_am/zahlungen/zahlung_stand`, `app.mahn_konfig`, `nachfass_stufen` + Gebühr/Pauschale/Zinshinweis/Freigabe, `nachfass_laeufe.angebot_id` nullable + `rechnung_id` + `mahnung_lexware_id` + `status`, Check „genau eins“, eindeutig je Rechnung+Stufe; Mail-Zwecke `rechnung`, `mahnung`; Rechte für bestehende Rollen.

### Task 2: Rein (Unit-Tests)
- [x] `src/lib/rechnungen.ts`: `zahlStatus`, `STATUS_NAMEN`, `verzugszinsenCent`, `schlussBetrag`, `abschlagBetrag`.
- [x] `belege.ts`: `rechnungAlsLexware` (Pflichttexte nur privat, 13b/Kleinunternehmer, Zeitraum, Zahlungsziel), `mahnungAlsLexware`.

### Task 3: Attrappe
- [x] `POST/GET /v1/invoices[/file]` (Vorgänger-Prüfung 406), `GET /v1/payments/{id}`, `POST/GET /v1/dunnings[/file]` (nicht in der Belegliste), Helfer `festschreiben()`, `bezahle()`.

### Task 4: Rechnung + Zahlungsstand (Server + DB-Tests)
- [x] Vorschlag/Dialog, erstellen (409 bei laufender), Handler, Abgleich (Zuordnung, draft→open, Zahlung holen), Ereignis `payment.changed`, Liste/Detail/Kunde/Auftrag, PDF, Senden.

### Task 5: Mahnungen (Server + DB-Tests)
- [x] Einstellungen (Stufen + Konfig + Standard), Engine, Freigabe, Pause, Stopp bei Zahlung, Lexware-Mahnung + PDF, Senden.

### Task 6: Oberfläche
- [x] Auftrag: Rechnungen in „Ausgangsbelege“ + Dialog; Seite `/rechnungen/[id]`; Ausgangsbelege → Rechnungen (Filter, Kacheln); Kundenakte; Startseiten-Kachel; Einstellungen → Mahnungen.

### Task 7: Sprache, Funktionen, Prüfen, commit, push
- [x] Sprachaktionen + Tests; `npm test`, betroffene `test:db`, `npm run check`, `npm run build`; commit + push `lexware`.

## Nicht in Phase 3 (folgen)
Storno per Gutschrift (`credit-notes`), Aufgabe „Auftrag fertig, noch keine Rechnung“ (§ 14 Abs. 2 UStG, 6 Monate), ZUGFeRD/XRechnung-Auswahl beim Versand, automatischer Versand nach 4 Wochen, Kennzahlen „abgerechnet“/„Zahlungsdauer“, T0-Probelauf mit XL-Testkonto (Dunning-PDF im Entwurf? Deeplink-Pfad für Mahnungen? `paymentConditions` Pflicht?), E2E-Kette.
