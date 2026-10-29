# Konzept: Anfragequellen & Abläufe (Entwurf, noch nicht gebaut)

Stand 29.10.2026 · Wünsche von Jamil, Talk msgs 3688, 3692/3693 (Antwort 3689) · **Erst Jamils Okay, dann bauen.**

> **Umsetzungsstand (msg 3703):** Jamil hat NUR den Ablauf pro Quelle freigegeben („gilt / überspringen“). Gebaut ist Etappe 2
> (Migration 112, Abschnitt „Ablauf je Auftragsquelle“ auf der vorhandenen Seite Auftragsquellen). Alles andere (Art, Standard-
> Quelle, Angebotsart/Empfänger, Website-Formular, Mail-Eingang, Umbenennung) ist NICHT gebaut und bleibt Vorschlag.
>
> Festgelegt beim Bauen: Schritte = die offenen Untergruppen; ein Status gilt als übersprungen, wenn alle seine Schritte
> übersprungen sind. Neue Aufträge beginnen im ersten geltenden Status; „Weiter“, das Status-Menü und Ziehen im Board gehen zum
> nächsten bzw. vorigen geltenden Status; der Sprung in der Statusleiste (ausdrückliche Wahl) darf jeden Status setzen, auch einen
> übersprungenen (gestrichelt markiert). Bestehende Aufträge werden nie automatisch verschoben; steht einer in einem Status ohne
> geltenden Schritt, zeigt das Board ihn unter „Schritt übersprungen“. Die vorhandenen Kopplungen (Angebot versendet → Angebot,
> angenommen/Portal-Annahme → Beauftragt) bleiben unverändert, bis Jamil die Weiterschalt-Regeln (msg 3685 C/D) festlegt.
Die Regeln pro Quelle trägt Jamil selbst ein – dieses Konzept legt **keine** Partner-Regeln fest.

## Ziel in einem Satz

Jeder Auftrag trägt seine Anfragequelle als Label (Website, Hornbach, Direktanfrage …). In den Einstellungen legt
man pro Quelle fest, welche Schritte gelten und welche übersprungen werden und wie das Angebot aussieht. Die Quelle
wird, wo es geht, automatisch erkannt.

## 1. Was es heute schon gibt (Bestandsaufnahme)

| Thema | Heute im CRM |
| --- | --- |
| **Quelle als Feld** | Ja: **„Auftragsquellen“** (Migration 052/055). Tabelle `app.auftrag_quellen` (Name, Farbe, aktiv, Reihenfolge), **je Auftrag** `auftraege.quelle_id`. Bei neuen Aufträgen Pflicht, als farbiges Etikett auf Board-Karten und in der Liste, eigene Auswertung (`/auswertung/quellen`). Startliste: Website, Hornbach, Obi, Empfehlung, Zeitung, MyHammer, Telefon, Sonstiges, Online-Buchung. |
| **Quelle ↔ Partner** | Ja (Migration 094): eine Quelle kann auf einen **Auftraggeber-Partner** zeigen („Hornbach“ → Partner Hornbach); der Auftrag bekommt ihn dann automatisch als Auftraggeber (Trigger `auftraggeber_aus_quelle`). |
| **Quelle am Kunden** | Nein – nur am Auftrag. Ein Kunde kann also schon heute direkt **und** über Hornbach kommen. |
| **Einstellungsseite** | `Einstellungen → Anfrage → Auftragsquellen` (`/einstellungen/quellen`): Liste mit Farbe, Name, aktiv, Auftraggeber-Partner, ↑/↓, Löschen mit Rückfrage (benutzt → nur ausschalten), ⓘ `quellen.seite`. |
| **Wie Anfragen reinkommen** | **Manuell** (Auftrag anlegen, Quelle wählen) · **Online-Buchung** (Quelle fest je Terminart bzw. je Buchungslink, sonst „Online-Buchung“) · **Sprachsteuerung** (kann die Quelle setzen). **Kein** Website-Anfrageformular, **kein** Mail-Eingang – dafür gibt es noch keine Technik. |
| **Status & Untergruppen** | Statuskette fest (`lib/auftrag-status.ts`): Anfrage → Angebot → Beauftragt → In Arbeit → Abgenommen → Abgerechnet. Untergruppen nur in `UNTERGRUPPEN`/`untergruppe()` (`lib/auftrag-board.ts`): Termin vereinbaren/vereinbart, Angebot erstellen/erstellt, Umsetzung planen/geplant, Arbeiten durchführen → Qualität prüfen → Endabnahme durchführen. **Zuordnung vorläufig** (msg 3685), keine Automatik, die Karten weiterschiebt. |
| **Angebote** | Im CRM (Editor, PDF, Angebots-Vorlagen `app.angebot_vorlagen`, Versand, Portal-Annahme). Lexware ist bisher nur für Rechnungen geplant. |
| **Einstellungen allgemein** | Firma → Kunde → Auftrag (`docs/einstellungen-ebenen.md`), jede Einstellung mit ⓘ (`einstellungs-infos.ts`), Automatiken in „Funktionen & Automatisierungen“ (`funktionen.ts`), Abschnitte mit „Speichern“ oben rechts. |

**Folgerung:** Wir bauen auf den vorhandenen Auftragsquellen auf (keine zweite Liste). Neu sind Art, Erkennung,
Ablauf und Angebot **pro Quelle**.

## 2. Vorschlag

### a) Anfragequellen als Liste in den Einstellungen

Die vorhandene Seite wird zu **„Anfragequellen & Abläufe“** (gleicher Menüpunkt unter *Anfrage*). Links die Liste,
rechts die gewählte Quelle (am Handy untereinander). Je Quelle:

- **Name**, **Farbe/Label** (wie heute), **aktiv**, Reihenfolge.
- **Art:** Direkt · Website · Online-Buchung · Partner · Plattform · Sonstiges (nur zum Ordnen und für die Erkennung).
- **Auftraggeber-Partner** (wie heute, bei Art „Partner“).
- **„Standard für neue Anfragen“:** genau eine Quelle, vorgeschlagen **„Direktanfrage“** (neu in der Startliste).
- Löschen oben rechts mit `LoeschenKnopf`/`LoeschenPanel`; hängt die Quelle an Aufträgen, wird sie nur ausgeschaltet
  (wie heute).

### b) Automatische Erkennung pro Kanal

| Kanal | Wie die Quelle gesetzt wird |
| --- | --- |
| **Website-Formular** (neu) | Jede Quelle der Art „Website“ bekommt einen eigenen Formular-Link bzw. Einbett-Code (wie die Buchungslinks). Was darüber kommt, trägt **fest** diese Quelle. Seite im Design des Kundenportals (Regel msg 3662), Spamschutz wie bei der Online-Buchung. |
| **Online-Buchung** (gibt es) | Wie heute: Quelle je Terminart bzw. Buchungslink. |
| **Mail** (neu, später) | Ein Anfrage-Postfach wird abgerufen. Je Quelle trägt man **Absender-Adressen oder Domains** ein (z. B. `@hornbach.de`). Treffer → diese Quelle; kein Treffer → die Standard-Quelle. Die Mail landet als Anfrage mit Mailtext und Anhängen. |
| **Manuell** | Auswahl beim Anlegen, vorbelegt mit der Standard-Quelle („Direktanfrage“). |
| **Immer** | Die Quelle bleibt im Auftrag von Hand änderbar (wie heute; Änderung steht im Verlauf). |

### c) Ablauf pro Quelle

Pro Quelle eine Tabelle der Schritte (= die Untergruppen je Status) mit dem Schalter **„gilt / überspringen“**
(`Umschalter`, kein eigener Baustein):

| Status | Schritt | Standard |
| --- | --- | --- |
| Anfrage | Termin vereinbaren | gilt |
| Angebot | Angebot erstellen | gilt |
| Beauftragt | Umsetzung planen | gilt |
| In Arbeit | Arbeiten durchführen · Qualität prüfen · Endabnahme durchführen | gilt |

Dazu je Quelle **Varianten**:

- **Angebotsart:** *Standard* (das normale CRM-Angebot bzw. später Lexware) oder *Partner-Format* = eine gewählte
  **Angebots-Vorlage** (vorhandene Technik; Aussehen des Hornbach-Formats ist offen, Frage c).
- **Angebot geht an:** *Kunde* (Standard) oder *Auftraggeber-Partner* der Quelle.

**Wichtig:** Das **Standard-Profil entspricht genau dem heutigen Verhalten** (alles „gilt“, Standard-Angebot an den
Kunden). Jede Quelle startet mit dem Standard-Profil. Es werden **keine Partner-Regeln vorbelegt**. Was bei Hornbach
oder einem anderen Partner anders ist, stellt Jamil selbst ein.

### d) Nutzung im Board und in der späteren Automatik

- **Board:** Für einen Auftrag mit übersprungenem Schritt erscheint diese Untergruppe nicht. Beispiel: Ein Partner
  macht den Termin selbst, also gibt es keinen Schritt „Termin vereinbaren“. Der Auftrag steht dann gleich in der
  nächsten Gruppe. Die Zahlen bleiben richtig, weil sie aus denselben Regeln kommen (`untergruppe()` bekommt zusätzlich
  das Profil der Quelle).
- **Liste/Auftrag:** Das Kennzeichen neben dem Status zeigt den nächsten **geltenden** Schritt.
- **Spätere Automatik** (erst, wenn Jamil die Regeln sagt – msg 3685 C/D): übersprungene Schritte werden automatisch
  „weitergeschaltet“, das Angebot wird in der eingestellten Art erzeugt und an den eingestellten Empfänger adressiert.
  Neue Automatiken kommen in „Funktionen & Automatisierungen“ und „Was ist neu“.

### e) Datenmodell, Seiten, Aufwand

**Datenmodell (grob, je eine Migration pro Etappe):**

- `app.auftrag_quellen` + `art text` (Liste oben), `standard boolean` (höchstens eine je Betrieb, eindeutiger
  Teilindex), `angebot_art text` (`standard`/`vorlage`), `angebot_vorlage_id uuid` (→ `angebot_vorlagen`),
  `angebot_an text` (`kunde`/`partner`).
- `app.quellen_ablauf (quelle_id, schritt, gilt boolean)` – `schritt` = Untergruppen-Schlüssel aus `UNTERGRUPPEN`;
  fehlende Zeile = gilt (also Standard ohne Daten).
- `app.quellen_erkennung (quelle_id, art 'mail_absender'|'mail_domain', wert)` und Formular-Links analog
  `buchung_links` (`app.anfrage_links`: Token, Quelle, aktiv).
- Alles mit `betrieb_id`, RLS, zusammengesetzten Fremdschlüsseln und Änderungsprotokoll wie die anderen Tabellen.

**Betroffene Seiten:** Einstellungen „Anfragequellen & Abläufe“ (Umbau der Quellen-Seite), Auftrag anlegen
(Vorbelegung), Board/Liste (`untergruppe()` mit Profil), Angebot erstellen (Vorlage/Empfänger), neu: öffentliche
Anfrage-Seite (Website-Formular), später: Mail-Eingang. Funktionen & Automatisierungen, ⓘ-Texte, „Was ist neu“.

**Etappen (Aufwand grob):**

1. **Liste ausbauen** – Art, Standard-Quelle „Direktanfrage“, neue Seite Liste + Detail (klein, ca. 1 Tag).
2. **Ablauf pro Quelle** – gilt/überspringen, Board und Liste beachten es (mittel, ca. 1–2 Tage).
3. **Angebot pro Quelle** – Angebotsart (Vorlage) und Empfänger (mittel, ca. 1–2 Tage; braucht Antwort zu c).
4. **Website-Anfrageformular** – öffentlicher Link + Einbett-Code, setzt die Quelle fest (mittel, ca. 2 Tage).
5. **Mail-Eingang** – Postfach abrufen, Zuordnung per Absender/Domain (größer, ca. 2–3 Tage; braucht Postfach und Zugang).
6. **Automatik** – Weiterschalten nach Jamils Regeln (offen, erst nach seinen Vorgaben).

Einheitlichkeit: gemeinsame Bausteine (`Abschnitt` mit „Speichern“ oben rechts, `Umschalter`, `Auswahl`,
`AuftragsquelleEtikett`, `InfoFenster`), Löschen nur mit Bestätigung, alles Aufklappende schwebt (`$lib/overlay`).

### f) Offene Fragen an Jamil

- **a)** Welche Partner sind es genau (Hornbach, Obi, …)?
- **b)** Was ist pro Partner anders: Welche Schritte entfallen (z. B. Termin), wer bekommt was?
- **c)** Wie sieht das Hornbach-Angebot aus (Beispiel-PDF/Formular)? Geht es nur an Hornbach oder auch an den Kunden?
- **d)** Quelle am **Auftrag** (so ist es heute, ein Kunde kann direkt und über Hornbach kommen) – oder zusätzlich
  eine „übliche Quelle“ am Kunden als Vorschlag?
- **e)** Name: Heute heißt es „Auftragsquellen“ – sollen wir es überall **„Anfragequellen“** nennen?
- **f)** Mail-Eingang: Welches Postfach soll das CRM abrufen (z. B. eine eigene Anfrage-Adresse)?

Skizzen der Einstellungsseite (Desktop/Handy) und dieses Dokument: Nextcloud, Gruppenordner `Entwicklung/CRM-Anfragequellen`
(https://nextcloud.waybuild.de/f/20714), Kopie bei Can unter `KI-Assistent/CRM-Anfragequellen`.
