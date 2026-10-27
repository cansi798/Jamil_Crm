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
Die Auftragsseite zeigt für Kundeneinstellungen nur den Hinweis „wird beim Kunden eingestellt“ mit Link.

## Bestandsaufnahme (Stand 27.10.2026, vor Schritt 3)

| Einstellung | Firma | Kunde | Auftrag | Speicherort | Soll |
| --- | :-: | :-: | :-: | --- | --- |
| AGB (PDF/Link), Widerrufs-Link | ● | | | `portal_einstellungen` | Firma |
| Erscheinungsbild des Portals (Farben, Schrift) | ● | | | `betrieb_profil` | Firma |
| Welche Aufträge stehen im Portal („alle aktiven“/„nur markierte“) | ● | | ● (`sichtbar`) | `portal_einstellungen.standard`, `portal_auftrag.sichtbar` | Firma → **Kunde** (Auftrag nur Ausnahme) |
| Namen im Portal (Vorname/voll/aus) | ● | | ● (`mitarbeiter`) | `portal_einstellungen.team_namen`, `portal_auftrag.mitarbeiter` | Firma → **Kunde** |
| Der Kunde sieht: Status, Termine, Annahme online | | | ● (`status`, `termine`, `annahme`) | `portal_auftrag` | Firma-Standard → **Kunde** |
| Auftragsbestätigung automatisch | ● | | ● (`auftraege.ab_automatisch`, leer = Firma) | `portal_einstellungen.ab_automatisch` | Firma → **Kunde** |
| Karte „Leistungen für Bestandskunden“ an/aus | ● | | | `portal_einstellungen.bestand_aktiv` | Firma → **Kunde** (je Kunde ausschaltbar) |
| Karte: Überschrift, Text, Leistungen, Knöpfe | ● | | | `portal_einstellungen.bestand_*` | Firma |
| Portal-Link (Ablauf, Widerruf) | | ● | | `portal_links` | Kunde ✔ |
| Portal-Passwort | | ● | | `portal_zugang` (je Kunde) | Kunde ✔ |
| Kein automatisches Nachfassen | | ● (`kunden.kein_nachfassen`) | | `kunden` | Kunde ✔ |
| Nachfassen pausieren (ein Angebot) | | | ● (`angebote.nachfassen_pausiert`) | `angebote` | Auftrag/Angebot ✔ (auftragsspezifisch) |
| Nachfass-Stufen | ● | | | `nachfass_stufen` | Firma |
| Einzelnes Dokument/Link/Notiz „Im Kundenportal“ | | | ● | `portal_dokumente` | Auftrag ✔ (auftragsspezifisch) |
| Online-Buchung, Terminarten, Arbeitszeiten, Quellen | ● | | | `buchung_*`, `auftrag_quellen` | Firma |
| Mail-Vorlagen, Signatur | ● | | | `mail_vorlagen`, `betrieb_profil` | Firma |
| Erinnerungen (Push), Handy-Abgleich | | | | Konto (Benutzer) | Benutzer |

● = hier einstellbar · ✔ = entspricht schon dem Schema.

## Menü nach dem Weg des Kunden (Schritt 2)

Anfrage (Auftragsquellen, Terminarten, Online-Buchung) → Angebot (Katalog, Kalkulation, Nachfassen) → Auftrag (Kundenportal &
Auftragsbestätigung) → Abschluss & danach (Leistungen für Bestandskunden). Daneben Vorlagen, Team & Partner, Auswertungen,
Allgemein (Funktionen & Automatisierungen, Briefkopf, Erinnerungen, Handy, Was ist neu) und Benutzeradministration.

## Regeln für Neues

1. Jede neue Einstellung bekommt einen Info-Text (`src/lib/einstellungs-infos.ts`) und ein ⓘ (`InfoFenster`, `Abschnitt info=…`,
   `Schalter info=…`). Der Test `einstellungs-infos.test.ts` prüft das.
2. Jede neue automatische Funktion steht in `src/lib/funktionen.ts` (Übersicht) und in `src/lib/neuigkeiten.ts` (Was ist neu).
3. Betrifft die Einstellung den Kunden → Kundenakte (Vererbung Firma → Kunde), nicht den Auftrag.
