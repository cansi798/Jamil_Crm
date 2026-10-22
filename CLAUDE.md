# Regeln für die Weiterentwicklung

Allgemeines zu Stack, Tests und Sicherheitsmodell: `README.md`.

## Installationspaket (`installation/`) – muss immer funktionieren

Auftrag von Can (Talk, Nachricht 2665): Mit dem Ordner `installation/` muss sich die Software jederzeit per
Kopieren auf einen neuen Server bringen und dort mit einem Befehl (`./CRM-Installation.sh`) installieren lassen.
Deshalb gilt für **jede** neue Funktion bzw. jeden Commit:

1. **Neue Umgebungsvariable** → in `installation/.env.beispiel` eintragen (mit deutschem Kommentar und sinnvoller
   Vorgabe, nie mit echtem Geheimnis) **und** in `installation/docker-compose.yml` beim Dienst `app` (bzw. dem
   Dienst, der sie braucht) durchreichen. Geheimnisse (Name enthält `PASSWORT` oder `GEHEIMNIS`) bleiben in der
   Vorlage leer – `2-installieren.sh` erzeugt sie bei Neuinstallationen, `5-aktualisieren.sh` ergänzt fehlende
   Variablen in bestehenden Installationen automatisch (Geheimnisse zufällig). Neue Pflicht-Geheimnisse zusätzlich in
   der `sed`-Liste von `2-installieren.sh` erzeugen lassen.
2. **Neuer Dienst / Container** (Datenbank-Erweiterung, Worker, externer Dienst) → als Service in
   `installation/docker-compose.yml` (gehärtet wie die anderen: `no-new-privileges`, Speicherlimit, nur nötige
   Netze). Optionale, schwere Dienste über ein Profil (`profiles:`) und in `COMPOSE_PROFILES` dokumentieren.
3. **Datenbank-Änderungen nur als Migration** in `db/migrations/` (neue Datei, nie alte ändern). Der Dienst
   `migration` führt sie bei jedem Start/Update automatisch aus – keine Handarbeit auf dem Server.
4. **Dateien, die die laufende App braucht**, müssen im Image landen: ggf. `installation/Dockerfile` (Stufe
   `betrieb`) und `installation/Dockerfile.dockerignore` anpassen. Neue Dateien außerhalb der Datenbank (Uploads auf
   Platte o. Ä.) brauchen ein Volume **und** müssen in `6-sicherung-erstellen.sh` / `7-sicherung-wiederherstellen.sh`
   mitgesichert werden.
5. **Neue Systemabhängigkeit** (apt-Paket, native Bibliothek) → im `Dockerfile` installieren; Anforderungen an den
   Server (RAM, Ports) in `1-voraussetzungen-pruefen.sh` und `installation/ANLEITUNG.md` nachziehen.
6. **Vor dem Abschluss größerer Änderungen** den Probelauf machen: Paket bauen (`installation/paket-erstellen.sh`),
   in einem Wegwerf-Ordner auspacken und mit eigenem Projektnamen und freien Ports unbeaufsichtigt installieren
   (Beispiel siehe `installation/TESTPROTOKOLL.md`), Anmeldung + Sicherung + Wiederherstellung prüfen, danach
   `./9-deinstallieren.sh --ja`. Laufende Vorschau/Sandbox-Container dabei nie anfassen.

Skripte, Kommentare und `ANLEITUNG.md` bleiben auf Deutsch und in einfacher Sprache (Can ist kein Techniker).

## Menü-Gruppen (Regel von Jamil, Talk msg 2860)

Jede neue Seite bzw. jeder neue Bereich kommt in die passende Gruppe der Navigation (`src/lib/navigation.ts`):
**Hauptbereich** (Start, Kunden, Aufträge, Ausgangsbelege, Plantafel, Karte, Aufgaben), **Vorlagen**, **Stammdaten &
Kalkulation**, **Team & Partner** (Zeiten, Abwesenheiten, Kolonnen, Partner – Jamil msg 3089, früher „Personal & Zeiten“),
**Auswertungen**, **Automatisierung**, **Benutzeradministration**. Einträge
erscheinen nur mit Modul und Recht. Passt keine Gruppe, eine sinnvolle neue Gruppe anlegen bzw. die Reihenfolge
anpassen – und in der Talk-Notiz an Jamil IMMER sagen, was im Menü dazugekommen oder verschoben ist und warum.
`tests/unit/navigation.test.ts` mitziehen. Seiten ohne eigenes Menü (z. B. „Gespeicherte Ansichten“) bekommen keinen Eintrag.
Menü-Links haben nie einen Suchteil (`?…`) – jede Seite braucht einen eigenen Pfad, sonst sind zwei Einträge markiert
(msg 3085); markiert wird immer nur der genaueste Eintrag (`aktiverEintrag`).

## Löschen oben rechts (Regel von Jamil, Talk msg 3043)

Löschen eines ganzen Datensatzes (Kunde, Objekt, Auftrag, Angebot, Vorlage, Partner, Rolle …) steht immer oben rechts
im Seitenkopf: `LoeschenKnopf` + `LoeschenPanel` (`src/lib/components/ui/`), Details in `docs/design-regeln.md` 3a.
Löschknöpfe einzelner Listenzeilen (Notiz, Dokument, Position) bleiben in der Zeile.

## Einheitlichkeit (STÄNDIGE Regel von Jamil, Talk msgs 3054–3056)

Gleiche Arten von Seiten, Reitern und Listen haben immer denselben Aufbau und dieselben Bausteine
(**Filterleiste → Kennzahl-Streifen → Liste**). Neue Reiter oder Seiten benutzen die vorhandenen gemeinsamen Bausteine
(z. B. `components/ausgangsbelege/BelegSeite.svelte`, `FilterLeiste`, `KennzahlKacheln`, `Umschalter`) statt eine
eigene Variante zu bauen. **Vor jedem Commit** die Einheitlichkeit mit den Geschwister-Seiten prüfen (gleiche Suche,
gleiche Reihenfolge, gleiche Kacheln und Zeilen; Bildschirmfotos bei 1280 und 390 px nebeneinander). Details:
`docs/design-regeln.md`, Abschnitt 10b.

## Vor dem Löschen/Entfernen immer nachfragen (Regel von Jamil, Talk msg 3091)

Jede Aktion, die etwas löscht, entfernt oder widerruft, fragt vorher nach – auch einzelne Zeilen. Ganzer Datensatz:
`LoeschenKnopf`/`LoeschenPanel`; hinterlegte Dateien (Logo, AGB-PDF): `ui/DateiFeld.svelte`; alles andere (Zeilen,
Positionen, Fotos, Geräte …): `use:rueckfrage` bzw. `frage()` aus `src/lib/rueckfrage.ts`. Kein Löschen mit einem
Klick, kein `confirm()`. Details: `docs/design-regeln.md` 3b; in E2E-Tests `bestaetigen()` aus `tests/e2e/hilfe.ts`.

## Vorlagen-Seiten (Jamil msgs 3084, 3086)

Alle „…-Vorlagen“ sind gleich gebaut: Liste mit `vorlagen/VorlagenKopf` („+ Neue Vorlage“ oben rechts) und
`vorlagen/VorlagenListe` (Zeilen-Aktionen als `vorlagen/ZeilenAktion`), Detailseite mit `SeitenKopf` (Zurück,
Überzeile = Art, Titel = Name) und „Vorlage löschen“ oben rechts. Neue Vorlagen-Arten genauso bauen.

**Alles, was aufklappt, schwebt** (STÄNDIGE Regel von Jamil, Talk msg 3116): Auswahllisten, Menüs („Status ▾“, „⋯“),
Vorschlagslisten und Panels liegen als Overlay obenauf und schieben nie Inhalt, Karten oder Dialoge auseinander.
Immer über den gemeinsamen Helfer `$lib/overlay` (`schwebend`, `schwebendesDetails`, `overlayLage`) – nicht selbst
positionieren: oberste Ebene (Popover), klappt bei Platzmangel nach oben, Höhe begrenzt (scrollt in sich), schließt
bei Klick außerhalb, Esc und Scrollen.
