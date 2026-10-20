# CRM-System – Installation auf einem eigenen Server

Diese Anleitung erklärt Schritt für Schritt, wie das CRM auf einem neuen Server läuft.

Man braucht dafür keine Programmierkenntnisse – nur Kopieren, Einfügen und Enter.

&nbsp;

---

&nbsp;

## Kurz gesagt: 3 Schritte

&nbsp;

**1. Ordner auf den Server kopieren**

&nbsp;

**2. Einen Befehl ausführen:** `./CRM-Installation.sh` → im Menü **2** wählen

&nbsp;

**3. Im Browser die Domain öffnen und anmelden**

&nbsp;

Fertig. Die Einzelheiten stehen unten.

&nbsp;

---

&nbsp;

## Was ist „die exe“?

&nbsp;

Auf einem Linux-Server gibt es keine `.exe`-Dateien wie unter Windows.

Dort heißt das Startprogramm **`CRM-Installation.sh`**.

Es zeigt ein Menü mit allen Funktionen (installieren, starten, sichern …).

&nbsp;

Starten mit:

```
./CRM-Installation.sh
```

&nbsp;

---

&nbsp;

## Was man braucht

&nbsp;

- **Einen Server** mit Ubuntu (22.04 oder neuer) oder Debian (12 oder neuer).
  Mindestens 2 GB Arbeitsspeicher, besser 4 GB (für die Spracherkennung), 10 GB freier Platz.

&nbsp;

- **Eine Domain** (z. B. `crm.meinefirma.de`), die auf den Server zeigt.
  Beim Domain-Anbieter (z. B. all-inkl) einen **A-Eintrag** mit der IP-Adresse des Servers anlegen.

&nbsp;

- **Freie Ports 80 und 443** (in der Firewall des Servers bzw. beim Hoster freigeben).
  Darüber holt sich das CRM automatisch ein HTTPS-Zertifikat.

&nbsp;

- **Zugang zum Server** als `root` oder als Benutzer mit `sudo`.

&nbsp;

Docker muss **nicht** vorher installiert sein – das Skript bietet die Installation an.

&nbsp;

---

&nbsp;

## Schritt 1: Ordner auf den Server kopieren

&nbsp;

**Variante A – mit Paket (empfohlen):**

Auf dem Rechner, wo das CRM schon liegt:

```
cd installation
./paket-erstellen.sh
```

Das erzeugt im Ordner `dist-paket/` eine Datei wie `crm-system-0.0.1-20261020-1200-abc1234.tar.gz`.

&nbsp;

Diese Datei auf den neuen Server kopieren (Name anpassen, `SERVER` = IP oder Name des Servers):

```
scp dist-paket/crm-system-*.tar.gz* root@SERVER:/opt/
```

&nbsp;

Auf dem neuen Server auspacken:

```
cd /opt
sha256sum -c crm-system-*.tar.gz.sha256
tar -xzf crm-system-*.tar.gz
```

&nbsp;

**Variante B – mit Git:**

```
cd /opt
git clone https://github.com/cansi798/Jamil_Crm.git crm-system
```

&nbsp;

**Variante C – mit rsync** (kopiert den ganzen Ordner direkt):

```
rsync -a --exclude node_modules --exclude .env --exclude installation/sicherungen \
  ./ root@SERVER:/opt/crm-system/
```

&nbsp;

---

&nbsp;

## Schritt 2: Installieren

&nbsp;

```
cd /opt/crm-system/installation
./CRM-Installation.sh
```

&nbsp;

Im Menü zuerst **1** (Voraussetzungen prüfen), dann **2** (Installieren) wählen.

&nbsp;

Das Skript fragt:

- die **Domain** (z. B. `crm.meinefirma.de`)
- den **Firmennamen**
- die **E-Mail des ersten Admins**
- den **Namen des Admins** und ein **Passwort** (leer lassen = es wird eins erzeugt und angezeigt)

&nbsp;

Alles andere (Datenbank-Passwörter usw.) erzeugt das Skript selbst und speichert es in `installation/.env`.

&nbsp;

Beim ersten Mal dauert es **5 bis 15 Minuten** (Programme werden gebaut).

&nbsp;

---

&nbsp;

## Schritt 3: Anmelden

&nbsp;

1. Im Browser `https://crm.meinefirma.de` öffnen.

2. Mit der Admin-E-Mail und dem Passwort anmelden.

3. Die **Zwei-Faktor-Anmeldung** einrichten (QR-Code mit einer Authenticator-App scannen, z. B. Google Authenticator). Das ist Pflicht.

4. In der **Verwaltung** den Betrieb (die Firma) anlegen und den Chef per E-Mail einladen.

&nbsp;

---

&nbsp;

## Alle Funktionen im Überblick

&nbsp;

| Menü | Skript | Was es tut |
| --- | --- | --- |
| 1 | `1-voraussetzungen-pruefen.sh` | prüft den Server, installiert auf Wunsch Docker |
| 2 | `2-installieren.sh` | richtet alles ein (einmalig) |
| 3 | `3-starten.sh` | startet das CRM |
| 4 | `4-stoppen.sh` | hält das CRM an (Daten bleiben) |
| 5 | `5-aktualisieren.sh` | Update auf eine neue Version (macht vorher eine Sicherung) |
| 6 | `6-sicherung-erstellen.sh` | erstellt eine Sicherung |
| 7 | `7-sicherung-wiederherstellen.sh` | spielt eine Sicherung zurück |
| 8 | `8-status-und-logs.sh` | zeigt, ob alles läuft, und die letzten Meldungen |
| 9 | `9-deinstallieren.sh` | entfernt das CRM (Sicherungen bleiben) |
| 10 | `paket-erstellen.sh` | baut ein Paket für einen anderen Server |

&nbsp;

Jedes Skript kann man auch direkt starten, z. B. `./6-sicherung-erstellen.sh`.

Wer `make` kennt: `make installieren`, `make sicherung`, `make status` usw. (Liste: `make hilfe`;
ggf. vorher `sudo apt-get install -y make`).

&nbsp;

---

&nbsp;

## Update (neue Version einspielen)

&nbsp;

**Mit Git** (wenn der Ordner per `git clone` kam):

```
./5-aktualisieren.sh
```

&nbsp;

**Mit neuem Paket:** Paket auf den Server kopieren, dann:

```
./5-aktualisieren.sh /opt/crm-system-NEUE-VERSION.tar.gz
```

&nbsp;

Das Skript macht **immer zuerst eine Sicherung**, holt dann die neue Version, baut neu und startet neu.

Die Datenbank wird dabei automatisch auf den neuen Stand gebracht.

Einstellungen (`.env`) und Sicherungen bleiben erhalten.

&nbsp;

---

&nbsp;

## Sicherung (Backup)

&nbsp;

```
./6-sicherung-erstellen.sh
```

&nbsp;

Die Sicherung landet in `installation/sicherungen/` als eine Datei, z. B. `crm-sicherung-2026-10-20_031500.tar.gz`.

Sie enthält **alle Daten** (auch Fotos und PDFs) und eine Kopie der Einstellungen.

&nbsp;

**Jede Nacht automatisch sichern** (3:15 Uhr):

```
./6-sicherung-erstellen.sh --taeglich-einrichten
```

&nbsp;

Alte Sicherungen werden nach 14 Tagen gelöscht (einstellbar in `.env`: `CRM_SICHERUNG_TAGE`). Die neuesten 3 bleiben immer.

&nbsp;

**Wichtig:** Sicherungen regelmäßig **auf einen anderen Rechner** kopieren – wenn der Server kaputtgeht, sind sonst auch die Sicherungen weg:

```
scp root@SERVER:/opt/crm-system/installation/sicherungen/crm-sicherung-*.tar.gz* ./
```

&nbsp;

Die Sicherungen enthalten Passwörter und alle Kundendaten – **sicher aufbewahren**.

&nbsp;

---

&nbsp;

## Sicherung zurückspielen (Wiederherstellen)

&nbsp;

```
./7-sicherung-wiederherstellen.sh
```

&nbsp;

Das Skript zeigt alle Sicherungen, man wählt eine Nummer und bestätigt mit `WIEDERHERSTELLEN`.

Vorher sichert es automatisch den jetzigen Stand.

&nbsp;

**Umzug auf einen neuen Server:**

1. Auf dem neuen Server installieren (Schritte 1 und 2).
2. Die Sicherungsdatei nach `installation/sicherungen/` kopieren.
3. `./7-sicherung-wiederherstellen.sh` ausführen.

&nbsp;

---

&nbsp;

## Wenn etwas nicht klappt

&nbsp;

**Zuerst immer:**

```
./8-status-und-logs.sh
```

Das zeigt, welcher Teil nicht läuft, und die letzten Meldungen.

&nbsp;

**„Port 80/443 ist schon belegt“**

Auf dem Server läuft schon ein Webserver (z. B. Apache, Nginx oder ein anderer Caddy).
Entweder diesen beenden – oder in `.env` bei `COMPOSE_PROFILES` das Wort `https` entfernen und im vorhandenen
Webserver eine Weiterleitung auf `http://127.0.0.1:3000` einrichten.

&nbsp;

**Die Seite ist nicht erreichbar / kein Zertifikat**

- Zeigt die Domain auf den Server? Prüfen mit `ping crm.meinefirma.de` (muss die Server-IP zeigen).
- Sind die Ports 80 und 443 in der Firewall offen? (`sudo ufw allow 80,443/tcp` bei Ubuntu mit ufw)
- Meldungen von Caddy ansehen: `./8-status-und-logs.sh caddy`

&nbsp;

**Anmelden geht nicht, Formulare melden „Forbidden“**

In `.env` muss `CRM_ORIGIN` genau die Adresse im Browser sein (mit `https://`, ohne `/` am Ende).
Nach einer Änderung: `./3-starten.sh`

&nbsp;

**Spracherkennung antwortet nicht**

Sie braucht ca. 2 GB Arbeitsspeicher. Prüfen: `./8-status-und-logs.sh sprache`.
Abschalten: in `.env` bei `COMPOSE_PROFILES` das Wort `sprache` entfernen, dann `./3-starten.sh`.

&nbsp;

**Update ist schiefgegangen**

Die Sicherung von direkt vor dem Update liegt in `installation/sicherungen/`.
Alte Version wieder einspielen (altes Paket mit `./5-aktualisieren.sh altes-paket.tar.gz`), dann
`./7-sicherung-wiederherstellen.sh`.

&nbsp;

**Admin-Passwort vergessen**

Einen zweiten Admin anlegen:

```
./2-installieren.sh
```

(ändert nichts an den vorhandenen Daten; mit einer neuen E-Mail-Adresse wird ein neuer Admin angelegt.)

&nbsp;

---

&nbsp;

## Einstellungen (`installation/.env`)

&nbsp;

Alle Einstellungen stehen in `installation/.env` (Vorlage mit Erklärungen: `.env.beispiel`).

Nach jeder Änderung: `./3-starten.sh`

&nbsp;

Wichtige Einträge:

- `CRM_DOMAIN`, `CRM_ORIGIN` – Adresse des CRM
- `COMPOSE_PROFILES` – `https` (eigenes Zertifikat), `sprache` (Spracherkennung)
- `CRM_KI_ANBIETER`, `CRM_MISTRAL_KEY` – KI-Funktionen (optional)
- `CRM_SMTP_URL` – E-Mail-Versand (optional)
- `KARTE_KACHEL_URL`, `KARTE_KONTAKT`, `KARTE_ATTRIBUTION` – Kartendienst der Auftragskarte. Standard ist
  OpenStreetMap (für kleine Betriebe gedacht); bei vielen Nutzern einen eigenen Kachel-Server oder einen Anbieter
  mit Schlüssel eintragen (Beispiel in `.env.beispiel`).
- `CRM_SICHERUNG_TAGE` – wie lange Sicherungen aufbewahrt werden
- `NEXTCLOUD_…` – Verbindung zu einer Nextcloud (optional, siehe „Mit Nextcloud verbinden“)

&nbsp;

Die `.env` enthält Passwörter: **nie weitergeben, nie ins Git hochladen.**

&nbsp;

---

&nbsp;

## Mit Nextcloud verbinden

&nbsp;

Das CRM bleibt ein eigenes Programm mit eigener Anmeldung. Wer eine Nextcloud hat, kann beides verbinden. Jeder Teil
ist einzeln abschaltbar. Ohne diese Einstellungen ändert sich am CRM nichts.

&nbsp;

| Teil | Was man davon hat |
| --- | --- |
| Mit Nextcloud anmelden | Knopf auf der Anmeldeseite. Wer in Nextcloud angemeldet ist, ist mit einem Klick im CRM. |
| CRM-Kachel in Nextcloud | Menüpunkt „CRM“ oben in Nextcloud (nur für die Gruppen, die das CRM nutzen). |
| Kalender | Termine und Einsätze jeder Person erscheinen in ihrem Nextcloud-Kalender „CRM – Einsätze“. |
| Kontakte | Alle Kunden stehen im Nextcloud-Adressbuch „CRM Kunden“. |
| Dateien | Fotos, fertige Protokolle und versendete Angebote liegen in Nextcloud unter `CRM/Kunden/<Kunde>/<Auftrag>/`. |
| Talk | Erinnerungen kommen zusätzlich als Talk-Nachricht aufs Handy. |

&nbsp;

Alles läuft nur **vom CRM zur Nextcloud**. Was man in Nextcloud an diesen Kalendern, Kontakten oder Dateien ändert,
geht nicht ins CRM zurück. Beim nächsten Abgleich (alle 5 Minuten) wird es wieder überschrieben.

&nbsp;

### Schritt A: In der Nextcloud vorbereiten (Nextcloud-Admin)

&nbsp;

Die Befehle laufen auf dem Nextcloud-Server. Beim offiziellen Docker-Abbild beginnen sie mit
`docker exec -u www-data <nextcloud-container> php occ …`.

&nbsp;

**1. Technik-Konto anlegen.** Das ist ein ganz normales Konto **ohne** Admin-Rechte, mit dem das CRM überträgt:

```sh
occ group:add "CRM-Technik"
OC_PASS='ein-langes-zufälliges-passwort' occ user:add --password-from-env --display-name="CRM (Technik)" --group="CRM-Technik" crm-technik
occ user:auth-tokens:add crm-technik        # zeigt das App-Passwort EINMAL an → aufschreiben
```

&nbsp;

Mit dem App-Passwort meldet sich das CRM an. Es kann jederzeit unter „Persönliche Einstellungen → Sicherheit“ des
Kontos widerrufen werden. Ist in Nextcloud die Zwei-Faktor-Anmeldung Pflicht, gilt das für das App-Passwort nicht.

&nbsp;

**2. Gruppenordner „CRM“** (nur für „Dateien“; App „Team folders“ bzw. „Gruppenordner“). So landen die Dateien nicht
in einem persönlichen Ordner, sondern in einem gemeinsamen Ordner des Teams:

```sh
occ app:install groupfolders                 # falls noch nicht da
occ groupfolders:create CRM                  # gibt die Nummer des Ordners aus, z. B. 7
occ groupfolders:group 7 CRM-Technik read write delete
occ groupfolders:group 7 Team read           # das Team darf lesen (oder: read write delete)
```

&nbsp;

**3. „Mit Nextcloud anmelden“ einrichten** (App „OIDC Identity Provider“):

```sh
occ app:install oidc
occ oidc:create "CRM" "https://crm.ihre-firma.de/anmelden/nextcloud/rueckruf" --type=confidential --allowed_scopes="openid profile email"
```

&nbsp;

Der Befehl zeigt `client_id` und `client_secret` an → aufschreiben. Soll die erste Anmeldung Personen automatisch
über die E-Mail verknüpfen (Schritt C) und tragen Admins die E-Mail-Adressen in Nextcloud selbst ein, zusätzlich:

```sh
echo yes | occ config:app:set oidc overwrite_email_verified --value=true
```

&nbsp;

Sonst meldet Nextcloud die E-Mail als „nicht bestätigt“, und Personen müssen von Hand verknüpft werden. Die Adresse muss genau zur Adresse des CRM passen
(`CRM_ORIGIN` plus `/anmelden/nextcloud/rueckruf`). Danach in Nextcloud unter **Verwaltung → Sicherheit → OpenID
Connect** beim Eintrag „CRM“ die erlaubten Gruppen eintragen (z. B. nur „Team“). Alle anderen bekommen dann
„Zugriff verboten“.

&nbsp;

**4. CRM-Kachel** (App „Externe Seiten“, `occ app:install external`): In Nextcloud unter **Verwaltung → Externe
Seiten** einen Eintrag anlegen:

- Name: `CRM`
- Adresse: `https://crm.ihre-firma.de`
- Gruppen: nur die Gruppen, die das CRM nutzen (z. B. „Team“, nicht Gäste oder Externe)
- Symbol: eigenes Symbol hochladen (z. B. `static/icons/icon-192.png` aus dem CRM-Paket)
- Haken bei **„In neuem Tab öffnen“** setzen

&nbsp;

Warum ein neuer Tab? Das CRM lässt sich aus Sicherheitsgründen nicht in andere Seiten einbetten (Schutz vor
untergeschobenen Klicks). Außerdem würde der Browser die Anmeldung in einem eingebetteten Fenster einer anderen
Adresse nicht behalten.

&nbsp;

### Schritt B: Im CRM eintragen

&nbsp;

In `installation/.env` den Abschnitt „Nextcloud“ ausfüllen (Erklärungen stehen dort), zum Beispiel:

```sh
NEXTCLOUD_URL=https://cloud.ihre-firma.de
NEXTCLOUD_ANMELDUNG=ja
NEXTCLOUD_OIDC_CLIENT_ID=…            # aus Schritt A3
NEXTCLOUD_OIDC_CLIENT_SECRET=…        # aus Schritt A3
NEXTCLOUD_2FA_VERTRAUEN=ja            # nur wenn in Nextcloud 2FA für alle Pflicht ist (siehe unten)
NEXTCLOUD_TECHNIK_BENUTZER=crm-technik
NEXTCLOUD_TECHNIK_APP_TOKEN=…         # aus Schritt A1
NEXTCLOUD_KALENDER=ja
NEXTCLOUD_KONTAKTE=ja
NEXTCLOUD_KONTAKTE_GRUPPE=Team
NEXTCLOUD_DATEIEN=ja
NEXTCLOUD_TALK=ja
```

&nbsp;

Dann `./3-starten.sh`. Stimmt etwas an den Einträgen nicht, startet das CRM nicht und `./8-status-und-logs.sh` zeigt,
welcher Eintrag fehlt.

&nbsp;

### Schritt C: Personen verknüpfen

&nbsp;

Im CRM unter **Mehr → Nextcloud** (sichtbar mit dem Recht „Benutzer verwalten“) steht bei jeder Person ein Feld für
ihren **Nextcloud-Benutzernamen**. Eintragen, speichern – fertig. Haben CRM und Nextcloud dieselbe E-Mail-Adresse und
meldet Nextcloud sie als bestätigt (siehe Schritt A3), passiert das bei der ersten Anmeldung über Nextcloud automatisch.

&nbsp;

Wichtig:

- Über Nextcloud entstehen **nie neue CRM-Benutzer**. Die Person muss im CRM schon angelegt sein (Einladung).
- Plattform-Admins melden sich immer mit E-Mail, Passwort und Code an, nie über Nextcloud.
- Die normale Anmeldung mit E-Mail und Passwort bleibt immer möglich (z. B. wenn die Nextcloud nicht erreichbar ist).

&nbsp;

### Zwei-Faktor-Anmeldung und Nextcloud

&nbsp;

- **Empfohlen:** In Nextcloud die Zwei-Faktor-Anmeldung für alle CRM-Nutzer erzwingen (Verwaltung → Sicherheit) und
  `NEXTCLOUD_2FA_VERTRAUEN=ja` setzen. Dann prüft Nextcloud den zweiten Faktor, und das CRM fragt nicht doppelt.
- **Sonst** (`NEXTCLOUD_2FA_VERTRAUEN=nein`, Standard): Wer im CRM einen Bestätigungscode braucht (Chef, alle mit
  eingerichteter App), gibt ihn nach der Nextcloud-Anmeldung zusätzlich im CRM ein.

&nbsp;

### Was in der Nextcloud zu sehen ist

&nbsp;

- **Kalender:** Jede verknüpfte Person bekommt den Kalender „CRM – Einsätze (Name)“ geteilt, nur zum Lesen.
  Übertragen werden die Termine der letzten 30 Tage und des nächsten Jahres.
- **Kontakte:** Das Adressbuch „CRM Kunden“ wird mit der Gruppe aus `NEXTCLOUD_KONTAKTE_GRUPPE` geteilt, nur zum Lesen.
- **Dateien:** Fotos und fertige Protokolle der Aufträge sowie versendete und angenommene Angebote (PDF). Wird im CRM
  etwas gelöscht, verschwindet es auch in Nextcloud. Je Durchlauf werden höchstens 50 Dateien hochgeladen; der Rest
  folgt im nächsten Durchlauf.
- **Talk:** Das Technik-Konto schreibt der Person eine Nachricht, sobald eine Erinnerung fällig ist.

&nbsp;

Unter **Mehr → Nextcloud** steht, wann zuletzt abgeglichen wurde und ob es Fehler gab. Mit dem Recht
„Einstellungen“ gibt es dort auch den Knopf „Jetzt abgleichen“.

&nbsp;

### Sicherheit

&nbsp;

- Zugangsdaten stehen nur in `installation/.env` (nur für root lesbar). Sie stehen nie in der Datenbank, in
  Sicherungen der Datenbank oder in Protokollen. Die Sicherung (`6-sicherung-erstellen.sh`) enthält die `.env` –
  also Sicherungen genauso vorsichtig aufbewahren.
- Das Technik-Konto hat keine Admin-Rechte. Es schreibt nur in eigene Kalender und Adressbücher (die es teilt) und in
  den Ordner „CRM“. In persönliche Kalender, Kontakte oder Dateien anderer schreibt es nie.
- Bei „Mit Nextcloud anmelden“ prüft das CRM alles selbst: Herkunft (state), Einmalwert (nonce), PKCE und die
  Unterschrift der Nextcloud. Zu viele Versuche von einer Adresse werden 15 Minuten gesperrt.
- Abschalten: den Eintrag in `.env` auf `nein` setzen (oder `NEXTCLOUD_URL` leeren) und `./3-starten.sh`. In
  Nextcloud zusätzlich das App-Passwort des Technik-Kontos widerrufen und den OIDC-Client „CRM“ löschen.

&nbsp;

---

&nbsp;

## Mehrere CRM-Installationen auf einem Server

&nbsp;

Geht, wenn jede Installation einen eigenen Ordner, einen eigenen Namen (`CRM_PROJEKT`) und eigene Ports hat.

Ports 80/443 kann nur eine davon belegen – die anderen brauchen dann einen gemeinsamen Webserver davor.

&nbsp;

---

&nbsp;

## Für Entwickler

&nbsp;

Regeln für Weiterentwicklung (damit dieser Ordner immer funktioniert): siehe `CLAUDE.md` im Hauptordner,
Abschnitt „Installationspaket“.
