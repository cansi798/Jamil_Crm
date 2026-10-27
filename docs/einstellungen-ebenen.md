# Einstellungs-Ebenen: Firma → Kunde → Auftrag

Auftrag von Jamil (Talk msg 3423, 27.10.): **Zentralisierung.** Einstellungen, die den *Kunden* betreffen, werden **beim Kunden**
gesetzt – nicht beim Auftrag. Dieses Schema gilt für alles Neue und wird für Bestehendes schrittweise nachgezogen.

## Das Schema

| Ebene | Wofür | Wo einstellbar |
| --- | --- | --- |
| **Firma** | Standardwerte für alle | Einstellungen (Menü nach dem Weg des Kunden, siehe unten) |
| **Kunde** | Alles, was *diesen Kunden* betrifft (Portal, Kommunikation, Nachfassen, Zugang) | Kundenakte; überschreibt den Firmen-Standard, leer = erbt |
| **Auftrag** | Nur, was **wirklich auftragsspezifisch** ist (einzelnes Dokument freigeben, Angebot pausieren) | Auftragsseite |
| **Benutzer** | Persönliches (Erinnerungen, Handy) | Konto |

Vererbung: **Firma → Kunde → (Auftrag, nur wenn auftragsspezifisch)**. Ein leerer Wert bedeutet „erbt von oben“.
Die Auftragsseite zeigt für Kundeneinstellungen nur den Hinweis „wird beim Kunden eingestellt“ mit Link (umgesetzt in Schritt 3).

## Bestandsaufnahme

**Vorher (27.10.2026, vor Schritt 3)** lagen die Portal-Freigaben je Auftrag (`portal_auftrag`, `auftraege.ab_automatisch`).
**Jetzt (Schritt 3, Jamil msg 3439 „Option A“)** gelten sie je Kunde (`kunden_portal`, leer = erbt von der Firma); die Spalten am
Auftrag bleiben als Altwerte stehen (Migration 108 hat sie je Kunde übernommen), werden aber nicht mehr ausgewertet.

| Einstellung | Firma (Standard) | Kunde (überschreibt) | Auftrag | Speicherort |
| --- | :-: | :-: | :-: | --- |
| AGB (PDF/Link), Widerrufs-Link | ● | | | `portal_einstellungen` |
| Erscheinungsbild des Portals (Farben, Schrift) | ● | | | `betrieb_profil` |
| Aufträge im Portal zeigen („alle aktiven“ / „nur bei ausdrücklich eingeschalteten Kunden“) | ● (`standard`) | ● (`sichtbar`) | – | `portal_einstellungen.standard`, `kunden_portal.sichtbar` |
| Der Kunde sieht: Status, Termine, Namen der Mitarbeiter, Online-Annahme | ● (`frei_*`) | ● (`frei_*`) | – | `portal_einstellungen.frei_*`, `kunden_portal.frei_*` |
| Namen-Darstellung (Vorname / voll / keine) | ● (`team_namen`) | – | – | `portal_einstellungen.team_namen` |
| Auftragsbestätigung automatisch | ● | ● (`ab_automatisch`) | – | `portal_einstellungen`, `kunden_portal` |
| Karte „Leistungen für Bestandskunden“ an/aus, Texte, Leistungen, Knöpfe | ● | – (bewusst nicht je Kunde) | – | `portal_einstellungen.bestand_*` |
| Portal-Link (Ablauf, Widerruf), Portal-Passwort | | ● | | `portal_links`, `portal_zugang` |
| Kein automatisches Nachfassen | | ● (`kunden.kein_nachfassen`) | | `kunden` |
| Nachfassen pausieren (ein Angebot) | | | ● | `angebote.nachfassen_pausiert` |
| Nachfass-Stufen | ● | | | `nachfass_stufen` |
| Einzelnes Dokument/Link/Notiz „Im Kundenportal“ | | | ● (auftragsspezifisch) | `portal_dokumente` |
| Online-Buchung, Terminarten, Arbeitszeiten, Quellen | ● | | | `buchung_*`, `auftrag_quellen` |
| Mail-Vorlagen, Signatur | ● | | | `mail_vorlagen`, `betrieb_profil` |
| Erinnerungen (Push), Handy-Abgleich | | | | Benutzer (Konto) |

● = hier einstellbar. Vererbung: Auftrag → *Kunde des Auftrags* → Firma → Standard (alles an, „alle aktiven Aufträge“).
Die Wirkung steht an je einer Stelle: `IM_PORTAL_SQL` und `freigabeSql()` in `src/lib/server/kundenportal.ts`,
`abAutomatisch()` in `auftragsbestaetigung.ts`. Die Auftragsseite zeigt nur den Hinweis „wird beim Kunden eingestellt“ mit Link
(den Link nur, wenn der Nutzer die Einstellung in der Kundenakte auch sieht: Modul Kundenportal, „Kundenportal verwalten“, „Alle
Aufträge ansehen“; Auftrag ohne Kunden → es gilt die Firma). Wird beim Kunden „Aufträge im Portal zeigen“ eingeschaltet und hat er
einen gültigen Link, erscheinen seine schon versendeten Angebote im Portal – genau wie beim Erzeugen des Links (msg 2793).

**Migration 108 (Übernahme der Altwerte je Kunde, vorsichtigste Auswahl):** war bei irgendeinem Auftrag des Kunden eine Freigabe
aus, ist sie beim Kunden aus; Regel „nur markierte“ + ein Auftrag ausdrücklich gezeigt → Kunde ja; Regel „alle aktiven“ + alle
ausdrücklich ausgeblendet → Kunde nein; Auftragsbestätigung: Abweichung vom Firmenwert wird übernommen. Alles andere erbt.

## Menü nach dem Weg des Kunden (Schritt 2)

Anfrage (Auftragsquellen, Terminarten, Online-Buchung) → Angebot (Katalog, Kalkulation, Nachfassen) → Auftrag (Kundenportal &
Auftragsbestätigung) → Abschluss & danach (Leistungen für Bestandskunden). Daneben Vorlagen, Team & Partner, Auswertungen,
Allgemein (Funktionen & Automatisierungen, Briefkopf, Erinnerungen, Handy, Was ist neu) und Benutzeradministration.

## Regeln für Neues

1. Jede neue Einstellung bekommt einen Info-Text (`src/lib/einstellungs-infos.ts`) und ein ⓘ (`InfoFenster`, `Abschnitt info=…`,
   `Schalter info=…`). Der Test `einstellungs-infos.test.ts` prüft das.
2. Jede neue automatische Funktion steht in `src/lib/funktionen.ts` (Übersicht) und in `src/lib/neuigkeiten.ts` (Was ist neu).
3. Betrifft die Einstellung den Kunden → Kundenakte (Vererbung Firma → Kunde), nicht den Auftrag.
