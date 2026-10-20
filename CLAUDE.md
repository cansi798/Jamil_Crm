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
