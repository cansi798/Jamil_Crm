# Handwerk CRM – Optimierungsbericht

**Datum:** 21.11.2026 (Lauf 20:42 – ca. 00:30 Uhr)
**Zeitrahmen:** gewählt „bis 01:00 Uhr“ (Can, Talk #6799), Skill handwerk-crm-optimizer v1.1
**Codebasis / Branch / Commit:** `cansi798/crm-system`, Branch `optimizer-20261121` (Basis `main` 49d5d3c)
**Umgebung:** lokal – eigener Prüf-Container (node:22) und eigener Testserver mit eigener Wegwerf-Datenbank
(`crm_e2e_opt`, `crm_test_opt*`); Vorschau, Vorschau-Datenbank und Produktion nicht angefasst
**Runden:** 3 (Geschwindigkeit + Fehler · Lexware + Sicherheit · Apple-Design Handy/Desktop + Testpflege)

## Executive Summary

Die App war schon gut abgesichert (strenge Mandantentrennung per RLS, CSP mit Nonce, kein `{@html}`, Lexware-Webhook mit
Signaturprüfung). Verbessert wurde vor allem dort, wo Handwerker es merken:

- **Schneller:** Tarif-Module werden je Seitenaufruf nur noch einmal gelesen (vorher bis zu ~12 Abfragen allein auf der
  Auftragsseite); Auftragsseite, Angebotsseite, Startseite und App-Rahmen laden ihre Teile gleichzeitig statt nacheinander.
- **Keine doppelten Rechnungen/ABs in Lexware:** Ein Serverfehler (502/503/504) beim Anlegen gilt jetzt als „ungewiss“ –
  vor dem nächsten Versuch wird in Lexware nachgesehen. „Erneut versuchen“ und „Abbrechen“ lassen Rechnungen nicht mehr hängen.
- **Richtiges Belegdatum** an den Zeitumstellungs-Tagen (vorher lag es eine Stunde im Vortag).
- **Sicherer:** Anmelde-Begrenzung zusätzlich je IP-Adresse gegen „Passwort-Sprühen“.
- **Ruhiger und besser bedienbar:** sichtbarer Fokus-Ring, lesbare Status-Pills, kein automatisches Hineinzoomen in Felder am
  iPhone, Ladebalken bei Seitenwechseln, Schutz vor Doppelklick, Rückfrage-Blase statt Browser-`confirm()`, Filterleiste
  steht auf allen Hauptseiten gleich hoch, letzte Blautöne des alten Designs ersetzt. Logo und Hauptknöpfe bleiben in der
  Logo-Beige-Hausfarbe.

Nicht umgesetzt (Freigabe nötig): Datenbank-Indizes und Trigger (Migrationen), Portal-Passwort, Nextcloud-Verknüpfung,
Lexware-Kundennummer als Primärschlüssel (#6748) – siehe „Freigaben erforderlich“.

## Priorisierte Befunde

| Prio | Bereich | Befund | Nachweis | Status |
|---|---|---|---|---|
| P1 | Lexware | 5xx beim Anlegen → Neuversuch ohne Nachsehen → doppelte Rechnung/AB möglich | `lexware/warteschlange.ts`, Test `lexware-angebote` (AB nach 503 genau einmal) | behoben |
| P1 | Lexware | „Erneut versuchen“ an der Rechnung suchte nur ab „jetzt“ → Duplikat möglich | `lexware/rechnungen.ts` `rechnungErneut` | behoben |
| P2 | Lexware | Warteschlange „Erneut versuchen“ hakte fehlgeschlagene Rechnung als erledigt ab | `rechnungAnlegen.ausfuehren` | behoben |
| P2 | Lexware | „Abbrechen“/„Verbindung trennen“ ließ Rechnung für immer „wartet“ | `auftragAbbrechen`, `trenneLexware` | behoben |
| P2 | Lexware | Sperre 5 Min. kürzer als längster Lauf → Doppellauf möglich | Sperre 20 Min. | behoben |
| P2 | Lexware | Belegdatum an Umstelltagen (29.03./25.10.) eine Stunde im Vortag | Unit-Test `lexware-belege` | behoben |
| P2 | Sicherheit | Anmelde-Begrenzung nur je E-Mail (Passwort-Sprühen) | Unit-Test `ratelimit` | behoben |
| P2 | Geschwindigkeit | Tarif-Module bis ~12× je Seitenaufruf, ~20 Abfragen nacheinander auf der Auftragsseite | `anfrage-speicher.ts`, `parallel.ts` | behoben |
| P2 | Bedienung | Status-Auswahl am Handy zeigte nach „Weiter →“ den alten Status | E2E `auftrag-kompakt` (mobil) | behoben |
| P2 | Bedienung | Doku-Seite behielt Dateien des vorigen Auftrags | `auftraege/[id]/dokumentation` | behoben |
| P2 | Design/A11y | Fokus-Ring ≈ 1,3:1, Pills Orange/Grau 3,5:1, blasser Text 2,5:1 | Kontrast berechnet | behoben |
| P2 | Handy | Felder 14 px → iOS zoomt bei jedem Feld | `stil/apple.css` | behoben |
| P3 | Bedienung | Doppeltes Absenden (Angebot ohne Auftrag, Rechnung, Lexware übertragen …) | `src/lib/einmalig.ts` | behoben |
| P3 | Regel Jamil 3091 | `confirm()` in Statuskette, Unterlagen, Angebots-PDF | Rückfrage-Blase | behoben |
| P3 | Einheitlichkeit | Filterleiste am Handy 3 px versetzt (/kunden, /auftraege, /todos) | E2E `ruhe` (390 + 1440) | behoben |
| P3 | Sicherheit | PDF-Dateinamen ohne gemeinsamen Helfer | `api/rechnungen|mahnungen/[id]/pdf` | behoben |
| P3 | Logik | `erlaubterWechsel` ließ unbekannte Status durch | Unit-Test `auftrag-status` | behoben |
| P2 | Geschwindigkeit | Fehlende Indizes (Änderungsprotokoll je Auftrag, Portal-Ereignisse je Link) | Migration nötig | offen (Freigabe) |
| P2 | Lexware | Webhook „Kontakt geändert“ verdeckt ungesendete CRM-Änderung | Trigger, Migration nötig | offen (Freigabe) |
| P2 | Sicherheit | Kundenportal-Passwort = PLZ (vor Annahme eines Angebots) | `portal-zugang.ts` | offen (Freigabe) |
| P1* | Sicherheit | Nextcloud-SSO verknüpft Konten automatisch per E-Mail (*nur falls Nextcloud unbestätigte Adressen als bestätigt meldet) | `nextcloud/konfig.ts` | offen (Freigabe) |
| P3 | Sicherheit | Testmodus erlaubt „admin“ ohne Passwort (nur bei Fehlkonfiguration) | Migration 010 | offen (Freigabe) |
| P3 | Geschwindigkeit | Kundenportal: ~8 Abfragen je Auftrag (öffentliche Seite) | `kundenportal-oeffentlich.ts` | offen (größerer Umbau) |

## Tatsächlich geänderte Dateien

| Pfad | Änderung | Zweck | Risiko |
|---|---|---|---|
| `src/lib/server/anfrage-speicher.ts` (neu), `src/hooks.server.ts`, `src/lib/server/tarif.ts` | Speicher je GET-Anfrage für Tarif-Module | weniger Abfragen | gering (POST liest frisch) |
| `src/lib/server/parallel.ts` (neu), `routes/(app)/auftraege/[id]/+page.server.ts`, `angebote/[id]/+page.server.ts`, `(app)/+page.server.ts`, `(app)/+layout.server.ts` | Laden gleichzeitig | Wartezeit | gering |
| `src/lib/server/lexware/warteschlange.ts`, `rechnungen.ts`, `konfig.ts`, `mahnungen.ts`, `belege.ts`, `routes/(app)/einstellungen/lexware/+page.server.ts` | 5xx = ungewiss, Sperre 20 Min., Erneut/Abbrechen, Datum | keine Duplikate | gering–mittel |
| `src/lib/auftrag-status.ts` | unbekannte Status nie erlaubt | Logik | gering |
| `src/lib/server/auth/ratelimit.ts`, `routes/anmelden/+page.server.ts` | Grenze je IP (nur Fehlversuche) | Sicherheit | gering |
| `routes/api/rechnungen/[id]/pdf`, `api/mahnungen/[id]/pdf` | gemeinsamer Dateinamen-Helfer | Sicherheit | gering |
| `src/lib/styles/basis.css`, `src/lib/farbe.ts`, `src/lib/stil/apple.css`, `src/lib/stil/komponenten.css`, `ui/Auswahl.svelte` | Fokus-Ring, Pills, Platzhalter, 16 px am Handy, Kopfhöhe, Tokens | Design/A11y | gering |
| `ui/LadeBalken.svelte` (neu), `(app)/+layout.svelte` | Ladebalken | Rückmeldung | gering |
| `src/lib/einmalig.ts` (neu) + 7 Formulare | Doppelklick-Schutz | Daten | gering |
| `StatusKette.svelte`, `AuftragUnterlagen.svelte`, `angebote/[id]/+page.svelte`, `einstellungen/mahnungen/+page.svelte` | Rückfrage-Blase, Gefahr-Farbe, Status-Auswahl | Regeln Jamil | gering |
| `auftraege/[id]/dokumentation/+page.svelte` | übernimmt neue Seitendaten | Fehler | gering |
| `src/app.html`, `static/manifest.webmanifest` | Browserleiste hell | Design | gering |
| `partner/[id]`, `PartnerFormular.svelte`, `a/[token]`, `karte` | Tastaturen, Farben | Handy/Design | gering |
| `scripts/start-testserver.sh` | Testserver startet mit frischer DB | Testpflege | gering |
| Tests: `tests/unit/anfrage-speicher.test.ts` (neu), `ratelimit`, `lexware-belege`, `auftrag-status`, `tests/db/lexware-angebote`, `tests/e2e/mahnungen-einstellungen.spec.ts` (neu), 43 E2E-Specs (Anmelde-Wartezeit) | | | |

## Tests / Security

| Test | Ergebnis | Beleg/Kommentar |
|---|---|---|
| Typecheck (`npm run check`) | bestanden | 0 Fehler (Warnungen 44 → 42) |
| Unit (`npm test`) | bestanden | 99 Dateien, 723 Tests |
| DB-Tests (`npm run test:db`) | bestanden | Server-Last 30–57: mit 5-s-Zeitlimit scheitern Tests nur am Zeitlimit; mit `--testTimeout=60000`: **92 Dateien, 1029 Tests bestanden** (Stand 6f8a237, eigene Prüfkopie) |
| E2E (Playwright, eigener Testserver) | bestanden (Auswahl) | ruhe (390/1440), auftrag-kompakt, smoke, rueckfrage, angebote, overlays, kundenakte, ausgangsbelege, loeschen-oben, auftrag-phase2, bildschirmfotos, mahnungen-einstellungen (neu) |
| Auth/Rechte/OWASP | Prüfung durch Sicherheits-Agent | keine mandantenübergreifende Lücke, kein XSS/Open Redirect gefunden; Befunde oben |
| Lexware Mock/Contract | bestanden | `tests/db/lexware*` gegen die Attrappe, keine echten Lexware-Aufrufe |

## Performance & UX vor/nach (Mobil und Desktop getrennt)

| Kennzahl / Bildschirm | Vorher | Nachher | Methode |
|---|---|---|---|
| LCP/INP/CLS p75 | n. v. | n. v. | nicht messbar (keine Echtnutzer-Messung vorhanden) |
| DB-Transaktionen für Tarif-Module je Auftragsseite | bis ~12 | 1 | Code-Zählung (`hatModul`-Aufrufe) |
| Abfragen nacheinander Auftragsseite (Teil nach den ersten Blöcken) | ~20 seriell | 2 Blöcke parallel | Code |
| Mobil 390 px: Filterleiste | 143,2 / 146,2 px | gleich | E2E `ruhe` |
| Mobil: Feldschrift | 14 px (iOS-Zoom) | 16 px | CSS |
| Fokus-Ring Kontrast | ≈ 1,3 : 1 | ≥ 5 : 1 | berechnet |
| Status-Pills Orange/Grau (weiße Schrift) | 3,45 / 3,53 : 1 | 5,22 / 5,37 : 1 | berechnet |
| Desktop 1280/1440 und Mobil 390: Kundenliste, Auftrag, Angebote, Katalog, Plantafel | – | ohne Querscrollen, Bildschirmfotos geprüft | Playwright `bildschirmfotos`, `smoke` (360 px) |

## Lexware Office / Supabase

**Lexware-Ist-Zustand:** zentraler Client mit Ratenlimit (≤ 2/s, 429 mit Retry-After), Warteschlange mit Idempotenz und
„ungewiss“-Prüfung, Webhook mit RSA-SHA512-Signatur und Duplikatschutz, Angebote/AB/Rechnungen/Mahnungen. In diesem Lauf
nur gegen die Test-Attrappe geprüft; keine echten Lexware-Schreibzugriffe.
**Sync- und Datenrisiken:** siehe offene Befunde (Webhook verdeckt CRM-Änderung; Abschlagsbrutto ±1 ct; Mahnung
„Erneut versuchen“; Ratenlimit je Prozess).
**Supabase-Bereitschaft:** Datenzugriff ist in `src/lib/server/*` gekapselt, Postgres mit RLS je Betrieb – ein späterer
Wechsel ist ohne UI-Umbau möglich. Kein Migrationszwang; Lexware-Kundennummer als Primärschlüssel bleibt beim Plan #6748.

## Offene Risiken und nächste Prioritäten

1. Indizes als Migration freigeben (Auftragsseite wird mit wachsendem Änderungsprotokoll sonst langsamer).
2. Kundenportal: Abfragen je Auftrag bündeln (öffentliche Seite, viele Abfragen).
3. Service Worker lädt beim ersten Start die ganze App vor (mobiles Datenvolumen) – nur die Hülle vorladen.
4. `ui/Auswahl` ohne `value`: zeigt nach Server-Änderungen evtl. den alten Wert (bei der Statuskette behoben) – allgemein lösen.
5. Kleine Knöpfe (`.klein`) am Handy 40 statt 44 px.

## Freigaben erforderlich

Siehe nummerierte Fragen an Can in der Talk-Meldung (gleiche Liste): Migrationen (Indizes, Trigger, Testmodus),
Portal-Passwort, Nextcloud-Verknüpfung, Abschlagsrechnung als Brutto, PDF-Farben, Lexware-Kundennummer (#6748 – nicht umgesetzt).

**Nächste Frage:** Möchtest du einen weiteren Optimierungslauf? Wenn ja, wie lange?
