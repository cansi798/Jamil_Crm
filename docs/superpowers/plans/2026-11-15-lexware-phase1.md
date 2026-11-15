# Lexware Phase 1 (Grundlage, Kunden-Abgleich, Mailversand vorbereitet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das CRM kann sich mit Lexware Office (Public API) verbinden, Anfragen sicher (Ratenlimit, Warteschlange, keine Doppelbelege) ausführen, Rückmeldungen (Webhooks) mit geprüfter Signatur annehmen, nachts abgleichen und Kunden mit Lexware-Kontakten abgleichen; der Mailversand per SMTP ist eingebaut, bleibt aber aus, bis ein Betrieb ihn einrichtet.

**Architecture:** Alles, was zu Lexware geht, wird zuerst als Auftrag in `app.lexware_auftraege` gespeichert (Idempotenz-Schlüssel je Betrieb eindeutig) und vom Hintergrund-Dienst über einen Client mit Ratenlimit (≤ 2 Anfragen/s je Schlüssel, Standard 1,5/s) ausgeführt. Geheimnisse (Lexware-Schlüssel, SMTP-Passwort) liegen AES-256-GCM-verschlüsselt (`CRM_GEHEIMNIS_SCHLUESSEL`) in Spalten, die `crm_app` nur schreiben, aber nicht lesen darf; gelesen werden sie nur über SECURITY-DEFINER-Funktionen für `crm_auth`. Webhooks kommen über `/api/lexware/ereignis`, werden per RSA-SHA512 (`X-Lxo-Signature`) geprüft, dedupliziert gespeichert und sofort mit 202 bestätigt.

**Tech Stack:** SvelteKit 2, Svelte 5, PostgreSQL (RLS), postgres.js, vitest, Playwright, nodemailer 10.2.1 (neu).

**Spec:** `scratchpad/crm-plan-rechnungen.md` (freigegeben von Jamil, Talk #6093), Abschnitte 3, 4 („Was passiert, wenn Lexware nicht erreichbar ist“), 5 und Tasks T1 (ohne Umstellung der Belege), T3, T4. Antworten Jamil: 1 XL ja, 5 Postfach kommt noch (Mail vorbereitet, inaktiv), 6 § 13b/§ 35a berücksichtigen.

## Global Constraints

- Migrationen ab **118** (geprüft 15.11.: höchste auf allen Zweigen 117): 118 Mailversand, 119 Lexware-Grundlage, 120 Kunden ↔ Lexware.
- RLS mit `betrieb_id` überall; DB-Tests mit zwei Betrieben.
- Geheimnisse nie im Klartext in DB, Log, Protokoll, Client oder Fehlermeldung; `Authorization` wird nie protokolliert.
- Lexware-Basis-URL `https://api.lexware.io`, überschreibbar mit `CRM_LEXWARE_URL` (nur für Tests/Attrappe).
- Ratenlimit: höchstens 2 Anfragen/s je Schlüssel (Doku „Rate Limiting“); Standardabstand 667 ms.
- Webhook: Antwort < 5 s, Signatur `X-Lxo-Signature` = base64(RSA-SHA512 über den JSON-Body), öffentlicher Schlüssel aus der Doku (`/webhookSignature/public/public_key.pub`).
- Mail: Standard `KEIN_VERSAND`; echter Versand nur, wenn der Betrieb SMTP eingerichtet **und** eingeschaltet hat und `CRM_MAILVERSAND` nicht `aus` ist; im Testmodus (`CRM_TESTMODUS=1`) ist `CRM_MAILVERSAND` standardmäßig `aus`.
- STANDING RULE: jede neue Funktion bekommt eine Sprachaktion (`abfrage_lexware`, `lexware_abgleich_starten`, `abfrage_kunde_lexware`, `abfrage_mailversand`).
- Jede Einstellung hat ein ⓘ (`einstellungs-infos.ts`), neue Seiten in `navigation.ts` (Gruppe „Allgemein“), neue Automatik in `funktionen.ts` und `neuigkeiten.ts`.
- Installationspaket: neue Variablen in `.env.beispiel` + `docker-compose.yml`; `CRM_GEHEIMNIS_SCHLUESSEL` in die `sed`-Liste von `2-installieren.sh`.
- Keine echten Lexware-Aufrufe und keine echten Mails aus Tests/Vorschau: Lexware-Attrappe `tests/hilfe/lexware-attrappe.ts` (Formate laut Doku), Mail-Attrappe über `setzeMailVersand`.

## Review Focus

1. Zeitüberschreitung beim Anlegen eines Kontakts → kein zweiter Kontakt in Lexware (Auftrag „ungewiss“, vor dem Neuversuch Suche nach Marke `CRM-Kunde <id>` in `note`). Test in Task 4.
2. Doppelter Klick / doppelter Aufruf „Kunde anlegen“ → genau ein Auftrag (Idempotenz-Schlüssel). Test in Task 3.
3. Webhook mit falscher, fehlender oder fremder Signatur → 401 und nichts gespeichert; dieselbe Meldung zweimal → eine Zeile. Test in Task 5.
4. 401 von Lexware (Schlüssel widerrufen/abgelaufen) → kein Wiederholen in Schleife, Verbindung „Schlüssel ungültig“, Aufgabe für den Chef. Test in Task 3.
5. Ohne `CRM_GEHEIMNIS_SCHLUESSEL` → Speichern von Schlüssel/Passwort wird mit klarer Meldung abgelehnt (nie Klartext speichern). Test in Task 1.

---

### Task 1: Verschlüsselung der Geheimnisse

**Files:** Create `src/lib/server/geheimnis.ts`; Test `tests/unit/geheimnis.test.ts`; Modify `installation/.env.beispiel`, `installation/docker-compose.yml`, `installation/2-installieren.sh`.

**Interfaces – Produces:**
- `verschluessele(klartext: string, zweck: 'lexware' | 'smtp', betriebId: string, env?): Buffer` – Format `0x01 | iv(12) | tag(16) | daten`, AAD = `zweck:betriebId`, Schlüssel = SHA-256(`zweck` + `CRM_GEHEIMNIS_SCHLUESSEL`).
- `entschluessele(b: Uint8Array, zweck, betriebId, env?): string` – wirft bei falschem Betrieb/Zweck/Schlüssel.
- `geheimnisBereit(env?): boolean`; ohne Schlüssel (< 32 Zeichen) wirft `verschluessele` `ApiFehler(503, '… CRM_GEHEIMNIS_SCHLUESSEL …')`.
- `hinweis(klartext): string` – „…“ + letzte 4 Zeichen (für die Anzeige).

- [ ] Test: Rundreise; anderer Betrieb/Zweck → Fehler; Klartext kommt im Chiffrat nicht vor; ohne Schlüssel → 503.
- [ ] Rot sehen, implementieren (node:crypto), grün sehen, Installationsdateien ergänzen, commit.

### Task 2: Mailversand (Migration 118, SMTP, Protokoll, Einstellungsseite)

**Files:** Create `db/migrations/118_mailversand.sql`, `src/lib/server/mail/versand.ts`, `src/lib/server/mail/smtp.ts`, `src/lib/server/mail/konfig.ts`, `src/routes/(app)/einstellungen/mail/+page.server.ts`, `+page.svelte`; Modify `src/lib/server/nachfassen.ts` (re-export), `auftragsbestaetigung.ts`, `buchung-oeffentlich.ts`, `email.ts`; Tests `tests/unit/mail-versand.test.ts`, `tests/db/mailversand.test.ts`.

**Migration 118:** `app.mail_konfig` (betrieb_id pk, aktiv bool default false, host, port 1–65535, sicherheit `starttls|ssl|keine`, benutzer, passwort bytea (nur insert/update für crm_app, kein select), passwort_hinweis, absender_name, absender_adresse, antwort_an, bcc, geaendert, geaendert_von); `app.mail_ausgang` (id, betrieb_id, art `angebot|ab|rechnung|erinnerung|mahnung|nachfassen|protokoll|buchung|test|sonstiges`, an, cc, bcc, betreff, bezug_typ, bezug_id, lexware_id, status `wartet|gesendet|fehler|kein_versand`, message_id, versuche, fehler, anhaenge jsonb [{name, sha256, bytes}], angelegt, gesendet_am, von_benutzer); RLS; `app.mail_zugang(p_betrieb uuid)` SECURITY DEFINER für crm_auth liefert Konfig inkl. Passwort-Chiffrat.

**Interfaces – Produces:**
- `MailVersand` (unverändert: `verbunden`, `senden(mail)`), `KEIN_VERSAND`, `setzeMailVersand(v)`, `mailVersand` (aus `nachfassen.ts` weiter exportiert).
- `mailVersandFuer(betriebId: string): Promise<MailVersand>` – Attrappe, falls gesetzt; sonst SMTP, wenn eingerichtet+aktiv+erlaubt, sonst `KEIN_VERSAND`.
- `sendeMail(k: Kontext, mail: Mail, meta: { art: MailArt; bezugTyp?; bezugId?; lexwareId? }): Promise<{ status: 'gesendet' | 'kein_versand' | 'fehler'; fehler?: string; id: string }>` – schreibt `mail_ausgang` vor und nach dem Senden.
- `ladeMailEinstellungen(k)`, `speichereMailEinstellungen(k, eingabe)`, `sendeTestmail(k, an)`; `mailStatus(k): { eingerichtet, aktiv, erlaubt, grund, fehler24h, letzte }`.
- `smtpVersand(cfg, transportFabrik?)`: nodemailer-Transport (`secure` bei ssl, `requireTLS` bei starttls), `from` = „Name <adresse>“, `replyTo`, `bcc`.

- [ ] Unit-Tests: `smtpVersand` übergibt die richtigen Optionen an die Transport-Fabrik; Attrappe gewinnt; `KEIN_VERSAND` ohne Konfig; `CRM_MAILVERSAND=aus` → kein Versand; ASCII-sichere Anhangnamen.
- [ ] DB-Tests: RLS zwei Betriebe; crm_app kann Passwort nicht lesen; `sendeMail` mit Attrappe → `gesendet` + SHA-256; ohne Konfig → `kein_versand`; Fehler der Attrappe → `fehler` mit Text.
- [ ] Bestehende Aufrufer (`auftragsbestaetigung`, `buchung-oeffentlich`) auf `mailVersandFuer` umstellen (Verhalten ohne Konfig unverändert).
- [ ] Einstellungsseite „E-Mail-Versand“ (Recht `einstellungen`): Felder, Passwort nur „neu setzen“, Testmail, Versandprotokoll (letzte 50). ⓘ-Texte, Navigation, Funktionen, Neuigkeiten. Commit.

### Task 3: Lexware-Grundlage (Migration 119, Konfig, Client, Warteschlange)

**Files:** Create `db/migrations/119_lexware_grundlage.sql`, `src/lib/server/lexware/{client,ratenlimit,konfig,warteschlange,dienst}.ts`, `tests/hilfe/lexware-attrappe.ts`; Tests `tests/unit/lexware-client.test.ts`, `tests/db/lexware.test.ts`.

**Migration 119:** `app.lexware_konfig` (betrieb_id pk, schluessel bytea [kein select für crm_app], schluessel_hinweis, gueltig_bis date, status `nicht_verbunden|verbunden|schluessel_ungueltig|fehler`, organisation_id uuid unique, firmenname, steuerart, kleinunternehmer, geprueft_am, letzter_fehler, kunden_anlegen bool default false, letzter_abgleich, eingerichtet_von); `app.lexware_auftraege` (id, betrieb_id, art, nutzlast jsonb, idempotenz text, unique(betrieb_id, idempotenz), status `wartet|laeuft|ungewiss|erledigt|pruefen|abgebrochen`, versuche, naechster_versuch, gesperrt_bis, letzter_fehler, ergebnis jsonb, lexware_id, angelegt, erledigt_am, von_benutzer); `app.lexware_protokoll` (methode, pfad, status, dauer_ms, fehler, auftrag_id, zeit); `app.lexware_belege` (Spiegel: typ, lexware_id unique je Betrieb, nummer, status, datum, faellig, brutto_cent, offen_cent, kontakt_id, kontakt_name, kunde_id, archiviert, geaendert_lexware, stand, veraltet); `app.lexware_ereignisse` (event_type, resource_id, event_date, organisation_id, unique(betrieb_id, event_type, resource_id, event_date), verarbeitet_am, ergebnis); `app.lexware_abos` (lexware_id, event_type); SECURITY-DEFINER für crm_auth: `lexware_schluessel(betrieb)`, `lexware_dienst_kontexte()` (Betriebe mit Status verbunden/fehler + Dienst-Benutzer mit Recht `einstellungen`), `lexware_ereignis_annehmen(org, typ, res, datum)` → `neu|doppelt|unbekannt`.

**Interfaces – Produces:**
- `class LexwareFehler extends Error { status: number | null; art: 'netz' | 'zeit' | 'grenze' | 'server' | 'schluessel' | 'vertrag' | 'konflikt' | 'daten' | 'nicht_gefunden'; wiederholbar: boolean; nachSekunden?: number }`.
- `lexwareClient(o: { schluessel: string; basis?: string; ratenKey: string; fetch?: typeof fetch; zeitlimitMs?: number; protokoll?: (e) => void })` → `{ get<T>(pfad), post<T>(pfad, body), put<T>(pfad, body), del(pfad) }`.
- `warteAufPlatz(key: string, abstandMs = 667): Promise<void>`, `sperreKey(key, ms)` (429 / Retry-After).
- `stelleEin(k, auftrag: { art: LexwareArt; nutzlast; idempotenz; lexwareId? }): Promise<{ id: string; neu: boolean }>`.
- `arbeiteAb(k, client, opts?: { max?: number; jetzt?: Date }): Promise<{ erledigt: number; fehler: number }>` mit Handler-Tabelle `HANDLER: Record<LexwareArt, { ausfuehren(c, n, k): Promise<{ lexwareId?: string; ergebnis? }>; vorhanden?(c, n, k): Promise<string | null> }>`.
- Wiederholung: Abstand `min(30 s · 2^(versuche-1), 6 h)`, ab 8 Versuchen `pruefen`; 401 → `pruefen` + Konfig `schluessel_ungueltig` + Aufgabe; 402/403/406/4xx → `pruefen` + Aufgabe; Zeitüberschreitung bei anlegenden Arten → `ungewiss`.
- `speichereLexwareSchluessel(k, schluessel, gueltigBis?)`, `pruefeVerbindung(k)` (GET `/v1/profile`, speichert organisationId/companyName/taxType/smallBusiness), `trenneLexware(k)`, `lexwareStatus(k)`.
- `starteLexwareDienst(ms = 60_000)` / `stoppeLexwareDienst()`; Lauf: Warteschlange je Betrieb, nachts ab 02:00 einmal je Tag Abgleich einstellen, Protokoll > 90 Tage löschen, `pg_try_advisory_lock`.

- [ ] Unit-Tests gegen die Attrappe: 429 → `grenze`, wiederholbar, `nachSekunden` aus Retry-After; 500/503 → `server`; Zeitlimit → `zeit`; 401 → `schluessel`, nicht wiederholbar; Abstand ≥ 667 ms zwischen zwei Anfragen desselben Schlüssels; Authorization nie im Protokoll.
- [ ] DB-Tests: RLS zwei Betriebe; crm_app liest Schlüssel nicht; `stelleEin` zweimal gleich → ein Eintrag; 429 → wartet mit Abstand; 401 → pruefen + Status + Aufgabe; Verbindung prüfen speichert Profil. Commit.

### Task 4: Kunden ↔ Lexware-Kontakte (Migration 120)

**Files:** Create `db/migrations/120_kunden_lexware.sql`, `src/lib/server/lexware/kontakte.ts`; Modify Kundenseite (Abschnitt „Lexware“); Tests `tests/unit/lexware-kontakte.test.ts`, `tests/db/lexware-kontakte.test.ts`.

**Migration 120:** `app.kunden` + `lexware_id uuid`, `lexware_version int`, `lexware_stand timestamptz`, `lexware_geaendert boolean default false` (Lexware hat geändert, „übernehmen?“), `bauleister_13b boolean default false`, `bescheinigung_13b_bis date`, `leitweg_id text` (XRechnung); unique (betrieb_id, lexware_id); Update-Rechte für crm_app.

**Interfaces – Produces:**
- `kontaktAusKunde(kunde, version?): LexwareKontakt` – privat → `person {salutation, firstName, lastName}`, firma → `company {name, contactPersons?}`, `roles.customer {}`, `addresses.billing[{street, zip, city, countryCode: 'DE'}]`, `emailAddresses.private|business`, `phoneNumbers.private|business`, `note` mit Marke `CRM-Kunde <id>`.
- Arten `kontakt_anlegen` (Idempotenz `kontakt_anlegen:<kundeId>`, `vorhanden` = Suche `GET /v1/contacts?name=…` + Marke), `kontakt_aktualisieren` (GET für aktuelle `version`, dann PUT; 409 → einmal neu lesen), `kontakte_abgleichen` (Seiten durch `GET /v1/contacts?customer=true`, verknüpft per Marke oder eindeutiger E-Mail; fehlende nur bei `kunden_anlegen`).
- `kundeNachLexware(k, kundeId)`, `kundeLexwareStand(k, kundeId)`, `starteKundenAbgleich(k)`, `setze13b(k, kundeId, { bauleister, bis })`.
- `contact.changed` → `lexware_geaendert = true` am verknüpften Kunden.

- [ ] Unit: Abbildung privat/firma (Snapshot der JSON-Felder), Marke, leere Felder weglassen.
- [ ] DB/Attrappe: anlegen → lexware_id+version am Kunden; Zeitüberschreitung → ungewiss → Neuversuch findet Kontakt per Marke, kein zweiter POST; Versionskonflikt 409 → neu lesen und erfolgreich; Abgleich verknüpft per E-Mail. Commit.

### Task 5: Webhooks, Abos, nächtlicher Belegabgleich

**Files:** Create `src/lib/server/lexware/{ereignis,abgleich}.ts`, `src/routes/api/lexware/ereignis/+server.ts`; Tests `tests/unit/lexware-signatur.test.ts`, `tests/db/lexware-ereignis.test.ts`.

**Interfaces – Produces:**
- `pruefeSignatur(roh: string, signaturB64: string | null, schluesselPem = LEXWARE_OEFFENTLICH): boolean` (zuerst roh, dann kompakt neu serialisiert); `setzeSignaturSchluessel(pem | null)` nur für Tests.
- `POST /api/lexware/ereignis`: Signatur → sonst 401; JSON prüfen (organizationId, eventType, resourceId uuid, eventDate) → sonst 400; `lexware_ereignis_annehmen` → 202 (`neu`/`doppelt`/`unbekannt`, Antwort ohne Details).
- `verarbeiteEreignisse(k)`: `contact.*` → Kunde markieren; `token.revoked` → `schluessel_ungueltig`; Belege (`invoice.*`, `quotation.*`, `order-confirmation.*`, `credit-note.*`, `down-payment-invoice.*`, `dunning.*`, `payment.changed`, `voucher.*`) → Spiegelzeile `veraltet = true` + Auftrag `belege_abgleichen`.
- Art `abos_einrichten`: gewünschte Typen `ABO_TYPEN` anlegen (POST `/v1/event-subscriptions` {eventType, callbackUrl}), 409 = vorhanden; fremde Callback-URLs nicht anfassen.
- Art `belege_abgleichen`: `GET /v1/voucherlist?voucherType=quotation,orderconfirmation,invoice,downpaymentinvoice,creditnote&voucherStatus=any&size=250&page=n` (bei `seit`: `updatedDateFrom`), Upsert in `lexware_belege` (Beträge in Cent), `kunde_id` über `contactId`.

- [ ] Unit: gültige Signatur (Testschlüsselpaar) → true; verändert/fehlend/fremd → false; kompakte Neuserialisierung.
- [ ] DB: Endpunkt-Funktion zweimal dieselbe Meldung → eine Zeile; unbekannte Organisation → nichts gespeichert; `token.revoked` → Status; Belegabgleich über 2 Seiten → Upsert, zweiter Lauf ändert nichts doppelt. Commit.

### Task 6: Einstellungsseite „Lexware verbinden“, Sprachaktionen, Dienst

**Files:** Create `src/routes/(app)/einstellungen/lexware/+page.server.ts`, `+page.svelte`; Modify `src/hooks.server.ts`, `src/lib/navigation.ts`, `src/lib/einstellungs-infos.ts`, `src/lib/funktionen.ts`, `src/lib/neuigkeiten.ts`, `src/lib/server/sprache/{aktionen,rechte,aufloesen,befehl,ausfuehren}.ts`, `src/lib/server/ki/{fake,anweisungen}.ts`; Tests `tests/unit/aktionen.test.ts`, `tests/unit/navigation.test.ts`, `tests/db/lexware-sprache.test.ts`, `tests/e2e/lexware-einstellungen.spec.ts`.

- Seite (Recht `einstellungen`, Modul `lexware`): Schlüssel einfügen (Feld `type=password`, nie wieder angezeigt, nur Hinweis „…abcd“), „gültig bis“, „Verbindung prüfen“, Firmenname/Steuerart/Kleinunternehmer aus Lexware, Webhook-Adresse (`ORIGIN` + `/api/lexware/ereignis`) + „Rückmeldungen einrichten“, „Kunden abgleichen“, Schalter „fehlende Kunden in Lexware anlegen“ (Standard aus), Warteschlange (offen/prüfen mit „Erneut versuchen“/„Abbrechen“ mit Rückfrage), letzte Protokolleinträge, „Verbindung trennen“ (Rückfrage).
- Sprachaktionen (alle ohne Rückfrage, nur Frage bzw. harmloses Einstellen eines Abgleichs): `abfrage_lexware` („Ist Lexware verbunden? Hängt etwas?“), `lexware_abgleich_starten` („Lexware-Abgleich starten“), `abfrage_kunde_lexware` {kunde} („Ist Kunde Müller in Lexware?“), `abfrage_mailversand` („Ist der Mailversand eingerichtet?“). Rechte: `einstellungen` (+ Modul `lexware` für die Lexware-Aktionen); `abfrage_kunde_lexware` zusätzlich `kunden.lesen`.
- Dienst in `hooks.server.ts` starten, außer `VITEST` oder `CRM_LEXWARE_DIENST=aus`.
- [ ] Unit- und DB-Tests für Sprachaktionen (Fake-KI erkennt die Sätze; Antwort-Karten), Navigation, ⓘ-Test.
- [ ] E2E (eigener Probe-Server + Attrappe): Schlüssel speichern → „Verbindung prüfen“ zeigt Firmenname der Attrappe; Mail-Einstellungen speichern, Passwortfeld leer nach dem Speichern. Commit, push `origin lexware`.

## Nicht in Phase 1 (folgen)

Angebote/AB/Rechnungen/Mahnungen über Lexware (T5–T9), Terminvorschläge (T10), Umschaltung/Altbelege (T11), `/api/intern/lauf` mit Timer im Installationspaket (T2; bis dahin läuft der Dienst im App-Prozess wie Erinnerungen), DNS-Prüfung SPF/DKIM/DMARC.
