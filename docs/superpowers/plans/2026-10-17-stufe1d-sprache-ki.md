# CRM System – Stufe 1d „Sprachsteuerung und KI“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nutzer tippen aufs Mikrofon, sprechen („Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Müller“), sehen eine Bestätigungskarte und speichern mit „Ja“. Die KI erstellt außerdem Angebotsentwürfe nur aus Katalogpositionen. Alles läuft mit den Rechten des angemeldeten Nutzers, Audio verlässt den Server nicht.

**Architecture:** Neuer Container `crm-stt` in der Sandbox (faster-whisper, nur im internen Netz, feste CPU/RAM-Grenzen) wandelt Audio in Text; Audio wird nach der Umwandlung gelöscht. Text → KI-Anbieter (Schnittstelle `KiAnbieter`, Umsetzung Mistral über EU-API mit Function Calling; `FakeKi` für Tests) → **genau eine** Aktion aus einer festen Liste mit JSON-Schema. Namen (Kunde, Mitarbeiter, Auftrag) löst der Server selbst auf (RLS), die KI bekommt keine Datenbankinhalte außer dem gesprochenen Text und – nur beim Angebotsentwurf – den Katalog (Bezeichnung, Einheit, Schlüssel, **keine Preise**). Ausgeführt wird über dieselben Dienste wie die Oberfläche (`legeAuftragAn`, `legeTodoAn` …) inkl. `darf()`.

**Tech Stack:** wie 1b/1c; neu: Python 3.12 + faster-whisper 1.2.1 im Container `crm-stt` (Modell `small` oder `medium`, Deutsch, int8), Mistral-API (`mistral-small-latest` für Aktionen, `pixtral` nur für Fotos im Angebotsentwurf) über `fetch` (keine SDK-Abhängigkeit), MediaRecorder im Browser.

**Spec:** `docs/spec/pflichtenheft-v1.1.html` – Abschnitt 2 (Spracherkennung auf eigenem Server, KI mit EU-Datenverarbeitung, nur nötige Daten), Abschnitt 4 (Ablauf, Bestätigungskarte, Rechte wie Nutzer, Katalog-only, Nachfragen), Abschnitt 6 Stufe 1 („Sprachsteuerung: mindestens Kunde, Auftrag, To-do und Termin anlegen/verschieben sowie Angebotsentwurf, immer mit Bestätigungskarte. Trefferquote ≥ 90 % bei einem Satz von 50 Test-Sprachbefehlen“; „KI-Entwurf aus Stichworten/Sprache/Foto mit Preisen nur aus dem Katalog“), Abschnitt 7.1 (Module `sprache`, `ki_angebote`, Grenze `ki_pro_monat`), Abschnitt 9.2 (Mistral), Abschnitt 10 (Risiken).

Voraussetzungen: Plan 1b umgesetzt; Plan 1c umgesetzt (für Task 7 Angebotsentwurf). **Von Can benötigt:** Mistral-Konto mit API-Schlüssel und AV-Vertrag (DPA) – bis dahin läuft alles mit `FakeKi`, Task 9 (Messung mit echter KI) wartet.

## Global Constraints

- Alle Global Constraints aus 1a–1c gelten.
- Module: Sprachsteuerung = `sprache`, KI-Angebotsentwurf = `ki_angebote`. Jede KI-Anfrage zählt gegen `grenzen.ki_pro_monat` des Tarifs (Kalendermonat Berlin); erreicht → 429 „KI-Kontingent dieses Monats aufgebraucht“. Transkription allein zählt nicht.
- Aktionsliste (exakt diese Schlüssel): `kunde_anlegen`, `auftrag_anlegen`, `todo_anlegen`, `einsatz_anlegen`, `einsatz_verschieben`, `angebot_entwurf`. Alles andere → „Das kann ich noch nicht“. Jede Aktion braucht dieselben Module/Rechte wie in der Oberfläche; fehlt etwas → Karte zeigt „Dafür fehlt Ihnen die Berechtigung“ statt Speichern.
- Nie ohne Bestätigung speichern: Die Sprach-API liefert nur einen **Vorschlag** (signiert, 10 Minuten gültig, an Benutzer und Betrieb gebunden); gespeichert wird erst mit `POST /api/sprache/ausfuehren` und genau diesem Vorschlag. Im Änderungsprotokoll wird `quelle = 'sprache'` vermerkt.
- Audio: höchstens 60 s und 5 MB je Aufnahme, Formate webm/opus, ogg/opus, mp4/aac, wav; wird nur im Arbeitsspeicher bzw. in einer temporären Datei des STT-Containers verarbeitet und sofort gelöscht; nie in der DB, nie in Logs. Der Text der Aufnahme wird nicht dauerhaft gespeichert (nur das Ergebnis der ausgeführten Aktion im Protokoll).
- KI bekommt nie: Kundennamen aus der DB, Adressen, Preise, Benutzerdaten. Sie bekommt: den gesprochenen Text, das heutige Datum (Berlin) und das Aktions-Schema; beim Angebotsentwurf zusätzlich Katalogpositionen (Schlüssel, Bezeichnung, Einheit, Gewerk).
- Datumsangaben („Montag“, „morgen um 8“, „übermorgen“) löst der Server in Berlin-Zeit auf (KI liefert relative Angaben + Uhrzeit im Schema); „Montag“ = nächster Montag, heute ausgeschlossen.
- Mehrdeutigkeit: Findet der Server mehrere Kunden/Mitarbeiter/Aufträge zu einem Namen, zeigt die Karte eine Auswahl („Meinen Sie Kunde Müller in Norderstedt oder in Hamburg?“); keiner gefunden → bei `kunde_anlegen` neu, sonst Hinweis.
- Ressourcen: `crm-stt` mit `cpus: 1.5`, `memory: 2g`, `cpu_shares: 64`, nur Netz `crm-intern`; Nextcloud hat Vorrang.

## Review Focus

1. Monteur sagt „Erstelle ein Angebot für Müller“ → Karte „Dafür fehlt Ihnen die Berechtigung“, keine KI-Anfrage mit Katalog, nichts gespeichert – Test in Task 5.
2. Vorschlag wird manipuliert (anderer Betrieb/Benutzer, geänderte Felder, abgelaufen) → 400/403, nichts gespeichert – Test in Task 5.
3. „Termin bei Müller morgen 8 Uhr mit Ali“ am Samstag 24.10.2026 23:30 → Sonntag 25.10. 08:00 Berlin (Zeitumstellungsnacht) – Test in Task 4.
4. Leere/stumme Aufnahme, 61 s, 6 MB, falsches Format → klare Meldung, kein KI-Aufruf, Kontingent unverändert – Test in Task 2.
5. KI liefert Position, die nicht im Katalog ist, oder einen Preis → wird verworfen bzw. als „bitte prüfen“ ohne Preis markiert; Preis immer aus dem Katalog – Test in Task 7.

---

## File Structure

```
/opt/crm-sandbox/docker-compose.yaml        # + Dienst crm-stt (nur Plan-Task 1; Änderung außerhalb des Repos, Backup anlegen)
stt/Dockerfile, stt/server.py, stt/README.md # STT-Dienst (im Repo, gebaut in der Sandbox)
db/migrations/015_sprache_ki.sql           # ki_nutzung (Zählung je Betrieb/Monat), Protokoll-Quelle
src/lib/server/sprache/stt.ts              # Client zum STT-Dienst
src/lib/server/ki/anbieter.ts              # Schnittstelle KiAnbieter + Auswahl per Umgebung
src/lib/server/ki/mistral.ts, src/lib/server/ki/fake.ts
src/lib/server/sprache/aktionen.ts         # Aktions-Schema (JSON Schema), Validierung
src/lib/server/sprache/aufloesen.ts        # Namen/Datum → IDs/Zeitpunkte (RLS), Mehrdeutigkeiten
src/lib/server/sprache/vorschlag.ts        # signierter Vorschlag (HMAC, 10 min)
src/lib/server/sprache/ausfuehren.ts       # Ausführung über bestehende Dienste
src/lib/server/ki/kontingent.ts            # ki_pro_monat zählen/prüfen
src/lib/server/ki/angebot-entwurf.ts       # Katalog-only Entwurf (nach 1c)
src/routes/api/sprache/+server.ts (Audio → Vorschlag), api/sprache/text/+server.ts (Text → Vorschlag), api/sprache/ausfuehren/+server.ts
src/lib/components/{Mikrofon,Bestaetigungskarte}.svelte, src/routes/(app)/+layout.svelte (Mikrofon-Knopf)
tests/unit/{aktionen,aufloesen-datum,vorschlag}.test.ts, tests/db/{sprache,kontingent,angebot-entwurf}.test.ts
tests/sprache/befehle.json (50 Testbefehle), tests/sprache/messen.ts (Trefferquote), tests/sprache/audio/*.wav (synthetisch + später echte Aufnahmen)
```

---

### Task 1: STT-Dienst `crm-stt`
**Files:** Create `stt/Dockerfile` (python:3.12-slim, faster-whisper==1.2.1, Modell beim Bauen in ein Volume laden), `stt/server.py` (HTTP `POST /transkribiere` multipart `audio` → `{ text, dauer_s, sprache }`, `GET /gesund`; Dekodierung mit PyAV über `AudioResampler` 16 kHz mono – **nicht** `WhisperModel.transcribe(pfad)`, bekannter PyAV-Fehler; temporäre Datei in `/tmp` mit `try/finally` löschen; max. 5 MB/60 s → 413/422), `stt/README.md`; Modify `/opt/crm-sandbox/docker-compose.yaml` (Dienst `crm-stt`, Härtung wie crm-dev, `cpus: 1.5`, `memory: 2g`, `cpu_shares: 64`, Netz nur `crm-intern`, Backup `docker-compose.yaml.bak-stt-<datum>`).
- [ ] Step 1: Test `stt/test_server.py` (pytest im Container): kurze synthetische WAV mit „Neuer Auftrag für Müller“ (vorher mit `espeak-ng -v de` erzeugt und eingecheckt) → Text enthält „Müller“ und „Auftrag“; 6 MB → 413; leere Datei → 422; nach dem Aufruf liegt keine Datei mehr in `/tmp`.
- [ ] Step 2: Run → FAIL · Step 3: Implement + `docker compose up -d crm-stt` · Step 4: Run → PASS; Messung: Zeit für 10 s Audio < 6 s, CPU-Grenze greift · Step 5: Commit `feat(1d): STT-Dienst crm-stt`

### Task 2: Audio-Endpunkt und STT-Client
**Files:** Create `src/lib/server/sprache/stt.ts` (`transkribiere(audio: Uint8Array, typ: string): Promise<{ text: string }>`; Umgebung `CRM_STT_URL=http://crm-stt:8080`), `src/routes/api/sprache/+server.ts` (Grundgerüst: Audio annehmen, prüfen, transkribieren; Vorschlag kommt in Task 4); Test `tests/db/sprache.test.ts` (STT per Test-Doppel).
- Prüfungen vor jedem weiteren Schritt: Modul `sprache`, angemeldet, Größe ≤ 5 MB, MIME-Typ in Liste, Magic Bytes passen (webm `1A45DFA3`, ogg `OggS`, mp4 `ftyp`, wav `RIFF…WAVE`); leerer Text → 422 „Ich habe nichts verstanden – bitte noch einmal“.
- [ ] Steps 1–5 (Tests: Review Focus 4; Kontingent bleibt unverändert) · Commit `feat(1d): Audio annehmen und transkribieren`

### Task 3: KI-Anbieter, Aktions-Schema, Kontingent
**Files:** Create `src/lib/server/ki/anbieter.ts` (`export interface KiAnbieter { aktionAusText(text: string, kontext: { heute: string }): Promise<KiAktion>; angebotsEntwurf(…): Promise<KiEntwurf> }`, Auswahl `CRM_KI_ANBIETER=mistral|fake`, ohne Schlüssel immer `fake`), `ki/mistral.ts` (Chat-Completions mit `tools` + `tool_choice: "any"`, Modell aus `CRM_KI_MODELL` (Standard `mistral-small-latest`), Timeout 20 s, 1 Wiederholung bei 429/5xx, Antwort strikt gegen Schema validiert, Schlüssel nur aus Umgebung `CRM_MISTRAL_KEY`, nie geloggt), `ki/fake.ts` (regelbasiert für Tests: erkennt die Formulierungen aus `tests/sprache/befehle.json`), `sprache/aktionen.ts` (JSON-Schemas der 6 Aktionen, z. B. `auftrag_anlegen { titel, kunde: {name, ort?}, objekt?: string, start?: { tag: 'heute'|'morgen'|'uebermorgen'|'wochentag'|'datum', wochentag?, datum?, uhrzeit? }, mitarbeiter?: string[] }`; `pruefeAktion(x): KiAktion` wirft bei Abweichung), `ki/kontingent.ts` (`verbrauche(k, art: 'aktion'|'entwurf'): Promise<void>` atomar gegen `grenzen.ki_pro_monat`, 429), Migration `015_sprache_ki.sql` (`app.ki_nutzung(betrieb_id, monat date, anzahl int, primary key(betrieb_id, monat))`, RLS; `app.aenderungen` um Spalte `quelle text default 'oberflaeche'` erweitert, Trigger übernimmt `current_setting('app.quelle', true)`).
- [ ] Steps 1–5 (Tests: Schema lehnt Zusatzfelder/falsche Typen ab; Kontingent 2 → dritter Aufruf 429, parallel 10 Aufrufe bei Grenze 5 → genau 5 ok; Mistral-Client gegen lokalen Test-Server (kein Internet im Test): richtige Header, Timeout, Schlüssel nicht in Fehlermeldung) · Commit `feat(1d): KI-Anbieter, Aktionen, Kontingent`

### Task 4: Auflösen und signierter Vorschlag
**Files:** Create `sprache/aufloesen.ts` (`loeseAuf(k, aktion: KiAktion, jetzt: Date): Promise<Vorschau>` – Kunden-/Mitarbeiter-/Auftragssuche per bestehender Suche (`sucheWoerter`), Ergebnis `{ art: 'eindeutig', werte } | { art: 'auswahl', feld, optionen[] } | { art: 'fehlt', meldung }`; Datum über `src/lib/zeit.ts`), `sprache/vorschlag.ts` (`signiere(v, benutzer, betrieb): string` HMAC-SHA256 mit `CRM_VORSCHLAG_GEHEIMNIS`, 10 min; `pruefe(token, benutzer, betrieb): Vorschau` wirft 400/403), API `POST /api/sprache` und `POST /api/sprache/text` liefern `{ vorschlag, karte: { titel, zeilen[], auswahl?, warnungen[] } }`.
- [ ] Steps 1–5 (Tests: Review Focus 3; „Montag“ am Montag → nächster Montag; zwei „Müller“ → Auswahl mit Ort; manipuliertes/abgelaufenes Token → 400; fremder Benutzer → 403) · Commit `feat(1d): Namen und Termine auflösen, Vorschlag signieren`

### Task 5: Ausführen mit Rechten und Protokoll-Quelle
**Files:** Create `sprache/ausfuehren.ts` (`fuehreAus(locals, token, auswahl?: Record<string,string>)` → ruft `legeKundeAn`, `legeAuftragAn` (+ Einsätze für genannte Mitarbeiter), `legeTodoAn`, `legeEinsatzAn`, `aendereEinsatz`; setzt `app.quelle='sprache'` in derselben Transaktion; prüft `darf()` je Aktion **vor** dem Schreiben), `api/sprache/ausfuehren/+server.ts`.
- [ ] Steps 1–5 (Tests: Review Focus 1 und 2; Auftrag mit 2 Mitarbeitern legt Auftrag + 2 Einsätze an und liefert Plantafel-Warnungen; Protokolleintrag hat `quelle='sprache'`) · Commit `feat(1d): Sprachaktionen ausführen`

### Task 6: Mikrofon und Bestätigungskarte (Oberfläche)
**Files:** Create `src/lib/components/Mikrofon.svelte` (Drücken-und-Sprechen: gedrückt halten **oder** antippen = Start/Stopp, sichtbarer Pegel, max. 60 s Countdown, MediaRecorder mit bestem unterstützten Format, iOS Safari mp4; Fallback Texteingabe „Befehl tippen“), `Bestaetigungskarte.svelte` (Titel, Zeilen, Auswahl-Knöpfe bei Mehrdeutigkeit, Warnungen gelb, Knöpfe „Ja, speichern“ / „Ändern“ (öffnet das normale Formular vorausgefüllt) / „Abbrechen“; große Touch-Ziele); Modify `(app)/+layout.svelte` (runder Mikrofon-Knopf unten rechts über der Navigation, nur mit Modul `sprache`).
- [ ] Steps 1–5 (E2E `tests/e2e/sprache.spec.ts` mit `FakeKi` und Texteingabe: „Neues To-do für Murat: Silikonfuge erneuern, bis Freitag“ → Karte → Ja → To-do erscheint; Mikrofon mit Fake-Audiodatei (`--use-file-for-fake-audio-capture`) → Karte erscheint) · Commit `feat(1d): Mikrofon und Bestätigungskarte`

### Task 7: KI-Angebotsentwurf (setzt Plan 1c voraus)
**Files:** Create `ki/angebot-entwurf.ts` (`entwirfAngebot(k, auftragId, eingabe: { stichworte?: string; text?: string; foto?: Uint8Array }): Promise<{ angebotId: string; pruefen: number[] }>` – KI bekommt nur Katalog ohne Preise und den Text/Foto, liefert `[{ katalogSchluessel, menge, unsicher: boolean }]`; Server legt Entwurf über `legeAngebotAn` + `speicherePositionen` an, Preise **aus dem Katalog**, unbekannte Schlüssel verworfen, `unsicher` → Beschreibung „bitte prüfen“ + gelbe Markierung im Editor; Foto ≤ 5 MB JPEG/PNG, nur an `pixtral` mit Zustimmungshinweis), API `POST /api/angebote/entwurf`, Knopf „KI-Entwurf“ im Auftrag (Modul `ki_angebote` + `angebote.bearbeiten` + `preise.sehen`).
- [ ] Steps 1–5 (Tests: Review Focus 5; Kontingent zählt 1; Entwurf ist `entwurf`-Status, nie versendet) · Commit `feat(1d): KI-Angebotsentwurf nur aus dem Katalog`

### Task 8: Testsatz 50 Befehle und Messung
**Files:** Create `tests/sprache/befehle.json` (50 Befehle: je ≥ 7 pro Aktion, Umgangssprache, Zahlen/Uhrzeiten/Wochentage, typische Bauwelt-Namen, 5 mehrdeutige, 3 nicht unterstützte; erwartetes Ergebnis als Aktion + Kernfelder), `tests/sprache/audio/` (die 50 Befehle synthetisch per `espeak-ng -v de` bzw. Piper-TTS, plus Platz für echte Bauwelt-Aufnahmen), `tests/sprache/messen.ts` (`npm run sprache:messen -- --anbieter=fake|mistral --audio`: Trefferquote Aktion + Kernfelder, Ausgabe Tabelle + Gesamt-%).
- [ ] Steps 1–5 (mit `FakeKi` ≥ 90 % als Plausibilitätsprüfung des Messwerkzeugs; echte Messung in Task 9) · Commit `test(1d): Testsatz 50 Sprachbefehle und Messwerkzeug`

### Task 9: Echte KI anbinden, messen, Abnahme
**Voraussetzung:** Can hat Mistral-Konto, API-Schlüssel und AV-Vertrag bereitgestellt (Schlüssel root-only in `/opt/crm-sandbox/.env` als `CRM_MISTRAL_KEY`, nie im Repo/Chat).
- [ ] `npm run sprache:messen -- --anbieter=mistral --audio` → Trefferquote ≥ 90 % (Pflichtenheft); sonst Prompt/Schema nachschärfen (Beispiele im System-Prompt), erneut messen; Ergebnis-Tabelle ins README.
- [ ] Vorschau neu bauen (Befehl aus Plan 1b Task 9, zusätzlich `CRM_KI_ANBIETER=mistral`), Bildschirmfotos (Mikrofon, Karte, Auswahl, Angebotsentwurf), Kosten der Messung notieren.
- [ ] Commit `feat(1d): Mistral angebunden, Trefferquote gemessen`
