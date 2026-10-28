# Design-Regeln (Theme „Handwerk“)

Auftrag Jamil (Talk 2828): modern, **einheitlich auf jeder Seite**, passend zum Handwerk – angelehnt an die Website
Bauwelt Handwerk (Anthrazit + warmes Gold, Montserrat-Überschriften). Diese Regeln gelten für jede neue Seite und
jede Änderung. Was hier steht, ist in gemeinsamen Bausteinen umgesetzt – **Bausteine benutzen, nicht nachbauen.**

## 1. Farben, Schrift, Abstände

| Token | Wofür |
| --- | --- |
| `--ui-akzent` | Füllung der Hauptaktion, aktiver Reiter/Segment, Markierungen. Standard Gold `#c3a56f` |
| `--ui-akzent-auf` | Text **auf** der Akzentfüllung (dunkel oder weiß, automatisch lesbar) |
| `--ui-akzent-text` | Akzent als **Text/Link** auf hellem Grund (Kontrast ≥ 4,6 : 1) |
| `--ui-akzent-hell` / `-zart` / `-rand` | Tönungen (gewählte Zeile, Hover, Rahmen) |
| `--ui-nav`, `--ui-anthrazit-*` | Seitenleiste, Kopfleiste (inkl. Logo-Feld) und Leiste unten – alle mit `--ui-nav` im selben Anthrazit (Jamil msg 3319), `--ui-anthrazit-*` nur für Abstufungen |
| `--ui-hintergrund`, `--ui-flaeche`, `--ui-band`, `--ui-rand` | Seite (warmes Off-White), Karten (weiß), Kopfband, Linien |
| `--ui-gruen/-orange/-rot/-blau/-lila/-grau` (+ `-hell`) | Statusfarben (Pills, farbiger Rand in Listen) |

- **Hausfarbe je Betrieb:** Einstellungen → Briefkopf → „Hausfarbe“. Die App-Hülle leitet daraus alle
  `--ui-akzent*`-Tokens ab (`src/lib/farbe.ts`). Nie Farben fest einbauen – immer Tokens.
- **Nie** `color: var(--ui-akzent)` für Text auf Weiß (zu hell) → `--ui-akzent-text`. Auf Akzent-Füllung immer
  `color: var(--ui-akzent-auf)`.
- **Schrift:** Überschriften, Knöpfe, Überzeilen `--ui-schrift-titel` (Montserrat); Text Inter. Beide liegen unter
  `static/schriften` (CSP erlaubt nur eigene Schriften).
- **Abstände** im 4er/8er-Raster (`--ui-a1` … `--ui-a5`), Radien: Felder `--ui-radius` (8 px), Karten
  `--ui-radius-karte` (12 px), Knöpfe/Chips Pille.

## 2. Knöpfe – EIN System

Baustein `components/ui/Knopf.svelte` (`art="primaer|sekundaer|ghost|gefahr"`, `symbol`, `href`, `voll`).
Altbestand nutzt die Klassen `kd-knopf` (primär), `kd-knopf hell` (sekundär), `knopf-ghost`/`knopf-subtil`
(ghost), `kd-knopf gefahr` (gefahr) – sie sehen identisch aus.

- Alle Knöpfe gleich hoch (40 px, Touch 44 px), Pillenform, Montserrat, Symbol **links** vom Text.
- **Je Bereich höchstens ein Primärknopf.** Löschen/Deaktivieren immer `gefahr`.
- Keine Aktion als reiner Text-Link. Navigation (zur Seite X) darf ein Link sein.

## 3. Seitenkopf

Baustein `components/ui/SeitenKopf.svelte`: Zurück-Link (optional) → Überzeile (optional) → **Titel links**,
Kennzahl darunter, **Hauptaktionen IMMER rechts** (`aktionen`-Snippet). Am Handy brechen die Aktionen unter den
Titel um und bleiben rechtsbündig. Kein zweiter Titel auf der Seite.

- **Keine doppelte Überschrift (Jamil msg 3060):** Auf der Startseite eines Bereichs (z. B. `/auftraege`, `/kunden`,
  `/einstellungen/rollen`) steht der Titel am Desktop nur in der dunklen Kopfleiste. Die App-Hülle macht die h1 dort
  automatisch zur Screenreader-Überschrift (`.bereichs-start` in `(app)/+layout.svelte`) – nichts pro Seite bauen. Am
  Handy (keine Kopfleiste) und auf Detailseiten (Titel = Datensatz) bleibt die h1 sichtbar. Trägt der Titel mehr als
  den Bereichsnamen (z. B. „Auslastung Oktober 2026“): `<h1 class="titel-bleibt">`.

### 3a. Löschen oben rechts (Jamil msg 3043)

Jede Aktion, die einen **ganzen Datensatz** löscht (Kunde, Objekt, Anlage, Auftrag, Angebot, Vorlage, Partner, Rolle,
Katalogposition, Dienst, Protokoll-Entwurf …), steht **oben rechts im Seitenkopf** (`.seiten-aktionen`) – nie unten auf
der Seite. Bausteine: `components/ui/LoeschenKnopf.svelte` („<Ding> löschen“, Stil `gefahr`) im Kopf und
`components/ui/LoeschenPanel.svelte` direkt unter dem Kopf (gemeinsames `bind:offen`): Warnung, „Abbrechen“,
„Endgültig löschen“. Schlägt das Löschen fehl, bleibt die Rückfrage offen und zeigt den Fehler (Server-Aktion:
`alsFormFehler(e, { loeschFehler: true })`, fetch-Seiten: `onbestaetigen` + eigener Fehlerzustand). Kein `confirm()`.
Kleine Löschknöpfe **in Listenzeilen** (eine Notiz, ein Dokument, eine Position) bleiben in der Zeile.

### 3b. Vor dem Löschen/Entfernen immer nachfragen (Jamil msg 3091)

Nichts verschwindet mit einem Klick: Datensätze über `LoeschenKnopf` + `LoeschenPanel`, hinterlegte Dateien (Logo, helle
Logo-Variante, AGB-PDF) über `components/ui/DateiFeld.svelte` – Vorschau, Dateifeld, darunter EINE Knopfzeile
„… hochladen/Ersetzen“ und „… entfernen“ nebeneinander, Rückfrage („Ja, entfernen“) direkt darunter (msgs 3090, 3097).

**Auch keine einzelne Zeile** (Notiz, Dokument, Position, Link, Kostenzeile, Foto, Ansicht, Gerät, Einsatz …) wird ohne
Rückfrage gelöscht, entfernt oder widerrufen:

- Zeilen und alles andere: die gemeinsame Rückfrage-Blase `src/lib/rueckfrage.ts` – `use:rueckfrage={'Notiz wirklich
  löschen?'}` am Knopf (Formular- oder Klick-Knopf), `use:rueckfrage` am `<form>`, wenn der Knopf ein Baustein ist, oder
  `await frage(knopf, …)` mitten im Ablauf. Text: „<Ding> wirklich löschen?“ bzw. `{ frage, ja: 'Entfernen' }`.
- **Kein `confirm()`** für Löschen/Entfernen. Die Blase funktioniert auch in offenen Dialogen; Escape/Klick daneben = Abbrechen.
- E2E: nach dem Klick `bestaetigen(page)` bzw. `bestaetigen(page, 'Entfernen')` aus `tests/e2e/hilfe.ts`.

### 3c. Vorlagen-Seiten (Jamil msgs 3084, 3086)

Auftrags-, Angebots-, Protokoll-, Aufmaß- und E-Mail-Vorlagen sehen gleich aus:

- **Liste:** `vorlagen/VorlagenKopf` (Titel, ein Satz wofür, „+ Neue Vorlage“ oben rechts) und `vorlagen/VorlagenListe`
  (Karte „Vorlagen“ mit Anzahl; je Zeile Name + Abzeichen, Kennzahl-Zeile, Beschreibung; Aktionen rechts als
  umrandete Knöpfe `vorlagen/ZeilenAktion` mit Symbol – nie blass). Weitere Listen (Beispiele, Archiviert, je Zweck)
  mit demselben Baustein.
- **Detail:** `SeitenKopf` mit Zurück zur Liste, Überzeile = Art („Protokoll-Vorlage“), Titel = Name, Kennzahl;
  Aktionen und „Vorlage löschen“ oben rechts; Inhalt in Abschnitten, Fuß mit Aktionen unten rechts.
- Protokoll- und Aufmaß-Vorlagen sind EIN Menüpunkt „Protokoll- & Aufmaß-Vorlagen“ mit zwei Reitern (Jamil msgs 3533/3535);
  jede Art behält ihren Pfad (`/einstellungen/protokoll-vorlagen`, `/einstellungen/aufmass-vorlagen`), markiert ist immer genau
  dieser eine Menüpunkt (`AUCH_AKTIV` in `navigation.ts`, msg 3085).

## 4. Abschnitte und Überschriften

Baustein `components/Abschnitt.svelte` (bzw. `Karte.svelte`): weiße Karte, getöntes Kopfband, Titel in
Montserrat-Großbuchstaben mit kleinem goldenem Strich davor, Aktionen rechts im Band. Überschriften nie unterstreichen,
keine Linie darunter.

## 5. Formulare

- Beschriftung **über** dem Feld (mittelstark, gedämpft); Pflichtfelder mit „*“.
- **Fuß:** Baustein `components/ui/FormFuss.svelte` – Aktionen **immer unten rechts**, „Abbrechen“ (sekundär)
  **links** von „Speichern“ (primär).
- Anlegen-Formulare eingeklappt: Baustein `components/AddPanel.svelte` („+ … hinzufügen“), außer die Seite IST das
  Formular.
- Keine Rahmen um Gruppen: `<fieldset>` bleibt für die Bedienung mit Screenreader, sieht aber aus wie eine normale Feldgruppe (Legende = Beschriftung). Größere Gruppen als Abschnitt.

## 6. Auswahl-Bausteine (statt Browser-Standard)

| Statt … | Baustein |
| --- | --- |
| `<select>` | `components/ui/Auswahl.svelte` – gleiche Attribute, `<option>` als Inhalt (1:1 tauschbar) |
| Optionsfelder (`type="radio"`) | `components/ui/Segmente.svelte` (Umschalter mit Segmenten) |
| Häkchen-Listen von Mitarbeitern, Personen-`<select>` | `components/ui/PersonWahl.svelte` (einzeln oder `mehrfach`, Avatare, Suche) |
| Einzelnes Ja/Nein-Häkchen | `components/ui/Schalter.svelte` |
| gering/mittel/hoch | `components/ui/StufenWahl.svelte` |
| Datum als Chip | `components/ui/DatumWahl.svelte` |
| Kundensuche mit „Suchen“-Knopf | `components/ui/KundeWahl.svelte` (Live-Suche, Treffer als Liste) |

- **Personen** werden überall mit `PersonWahl` gewählt oder gefiltert (Aufgaben, Aufträge, Plantafel, Zeiten,
  Karte, Abwesenheiten …) – gleiche Optik, gleiche Bedienung.
- Die Bausteine behalten echte Formularfelder darunter (Formularwert, Tastatur, Screenreader, Tests).

## 7. Listen und Filter

- **Filterleiste** `components/ui/FilterLeiste.svelte` auf jeder Listenseite gleich: Suche links
  (`components/ui/SuchFeld.svelte`, sucht beim Tippen – **kein „Suchen“-Knopf**), Filter-Chips daneben
  (z. B. `PersonWahl klein`), Ansicht-Umschalter rechts.
- Zeilen: Hover-Tönung, farbiger Rand links je Status, Status als farbige Pill, Personen als Avatar.
- Leere Listen: Symbol + hilfreicher Satz + passender Knopf.

## 8. Dialoge

Alle Dialoge (Sprache, Bestätigung, Einsatz …) gleich: Kopf mit Titel und Schließen, Inhalt, Fuß mit Aktionen
rechts (Hauptaktion ganz rechts). Am Handy als Blatt von unten, mit einer Hand bedienbar.

## 9. Ganze Arbeitsfläche (Jamil msg 2838)

- **Jede Seite nutzt die volle Breite** des Arbeitsbereichs – keine schmalen, mittig gesetzten Spalten am Desktop.
- Einstellungs- und Listenseiten: Tabellen/Raster über die ganze Breite, Aktionen je Zeile rechts.
- Formulare ab ca. 1100 px zweispaltig (`.kd-formular` macht das automatisch: kurze Felder nebeneinander,
  Textfelder, Gruppen, Hinweise und der Fuß über die ganze Breite).
- Nur reiner Lesetext behält eine maximale Zeilenlänge (`.ui-lesetext`, ca. 70 Zeichen).

## 10. Seitenvorlage „Ruhe“ (Jamil msgs 2919–2922)

Beim Durchklicken darf nichts springen. Jede Seite ist gleich aufgebaut:

1. **Brotkrumen-Zeile** (immer reserviert, auch leer): „← Zurück“ bzw. Überzeile.
2. **Seitenkopf** (`SeitenKopf` bzw. `header.seiten-kopf`): Titel einzeilig links, darunter eine Zeile Kennzahl;
   Aktionen rechts, oben bündig. Am Handy höchstens **eine** Hauptaktion neben dem Titel – Ansicht-Umschalter,
   Exporte usw. gehören in die Filterleiste.
3. **Filterleiste** (`FilterLeiste`) direkt darunter: Suche links, Filter, rechts Ansicht (Board/Liste,
   Monat/Woche/Tag/Team) – alle Bedienelemente gleich hoch (`--ui-seg-hoehe`).
4. Inhalt.

- **EIN Umschalter**: `components/ui/Umschalter.svelte` (Links oder Knöpfe), für Formulare `Segmente` – gleicher
  Stil. Keine eigenen Chips/Reiter/Pillen mehr bauen.
- **Personen filtern** (auch Plantafel und Karte): eine `PersonWahl` („Alle Personen“, mehrfach, mit Kolonnen als
  eigene Gruppe in derselben Liste) – keine langen Namenslisten.
- **Dichte „kompakt“** ist Standard (Tokens `--ui-seite-*`, `--ui-abstand-block`, `--ui-karte-*`, `--ui-kopfband`,
  `--ui-feld-abstand`): Abstände nur über diese Tokens, nie pro Seite. Tippziele bleiben ≥ 44 px.
- **Automatisch geprüft:** `tests/e2e/ruhe.spec.ts` misst auf allen Hauptseiten (1440 und 390 px), dass Titel,
  Filterleiste und Umschalter auf 1 px genau gleich stehen bzw. gleich hoch sind. Neue Hauptseite → in die Liste
  aufnehmen.
- **Gespeicherte Ansichten** stehen immer rechts in der Filterleiste (`FilterLeiste ansichten="<seite>"` bzw.
  `div.fl-rechts` in eigenen Filterformularen) – nie im Seitenkopf, sonst wird der Kopf am Handy höher.
- **Kennzahl-Kacheln** (`KennzahlKacheln`) direkt unter der Filterleiste: Zeitraum-Umschalter + Kacheln; Klick auf
  eine Kachel filtert die Liste, zweiter Klick hebt den Filter auf.

## 10b. Einheitlichkeit (Regel von Jamil, Talk msgs 3054–3056) – STÄNDIGE REGEL

„Je nachdem welche Belegart ich auswähle, sieht das alles anders aus. Bitte mehr Einheit.“ Daraus gilt für immer:

- **Gleiche Arten von Seiten, Reitern und Listen haben immer denselben Aufbau und dieselben Bausteine:**
  Filterleiste (Suche links → Reiter → Status-Chips → Ansichten rechts) → Kennzahl-Streifen
  („<TYP> · <ZEITRAUM>“ mit Zeitraum-Umschalter Monat/Quartal/Jahr/12 Mon./Gesamt an derselben Stelle, gleiche
  Kacheln) → Liste mit gleicher Zeile (Nummer · Kunde, darunter Auftrag · Titel · Datum, Status-Pill rechts).
- **Neue Reiter oder Seiten benutzen die vorhandenen gemeinsamen Bausteine** statt eine eigene Variante zu bauen.
  Beispiel Ausgangsbelege: alle Reiter laufen über `components/ausgangsbelege/BelegSeite.svelte` (Server:
  `lib/server/ausgangsbelege.ts`, Adressen: `lib/ausgangsbelege.ts`); eine neue Belegart ist nur eine neue
  `+page.svelte`, die `BelegSeite` mit Daten füllt.
- Was es (noch) nicht gibt, steht **im selben Rahmen** – Suche und Status gesperrt, Platzhalter-Kacheln „–“,
  Leerzustand mittig in der Listenkarte (Beispiel: Rechnungen vor der Lexware-Anbindung). Nie Teile weglassen.
- **Vor jedem Commit mit den Geschwister-Seiten vergleichen** (gleiche Reiter-Gruppe, gleiche Art Liste): Suche
  vorhanden? Gleiche Reihenfolge? Gleiche Kacheln und Zeilen? Bei 1280 und 390 px Bildschirmfotos nebeneinander.
- **Ampel/Status einer Kennzahl nur als farbiger Punkt, immer oben rechts in der Karte** (msg 3093):
  Baustein `components/ui/AmpelPunkt.svelte` (Bedeutung über aria-label/title „Status: gesund“), kein Text daneben.
- **Kennzahl-Kacheln verschlucken nie Text** (msg 3057): Titel brechen um, lange Werte stehen über dem Titel und
  werden notfalls kleiner, der Streifen bricht in die nächste Zeile um.
- **Alles, was aufklappt, schwebt** (msg 3116): Auswahllisten (`ui/Auswahl`), Menüs (`StatusMenue`, „⋯“-Menüs),
  Vorschlagslisten (`KundeWahl`, `PersonWahl`, `QuelleChip`), Panels (Glocke, Gespeicherte Ansichten) liegen als
  Overlay in der obersten Ebene und verschieben nie Inhalt, Karten oder Dialoge. Gemeinsamer Helfer `$lib/overlay`:
  `schwebend` (Svelte-Action für Listen/Panels), `schwebendesDetails` (für `<details>`-Menüs), `overlayLage`.
  Verhalten überall gleich: am Auslöser verankert, klappt nach oben, wenn unten kein Platz ist, Höhe auf den freien
  Platz begrenzt (scrollt in sich), schließt bei Klick außerhalb, Esc, Scrollen außerhalb und Größenänderung (außer
  man tippt gerade darin). Am Handy (390 px) nie breiter als der Bildschirm. Aufklappbare **Bearbeitungs-Zeilen**
  (z. B. eine Kostenzeile öffnen und ändern) sind keine Menüs und dürfen in der Liste aufklappen.

## 10a. Kundenportal

- Gleiches Design wie die App: Anthrazit-Kopf mit Logo, Hausfarbe als Akzent (`farbStil`), Montserrat-Titel.
- **Kopf (Jamil msgs 3087/3088, 3126):** Baustein `components/portal/PortalKopf.svelte`, gleich auf Portal und
  Passwort-Seite. Logo groß und ohne Feld, daneben klein „Ihr Kundenportal“. Welches Logo, entscheidet die Kopffarbe
  (`src/lib/portal-kopf.ts`): heller Kopf → normales Logo, dunkler Kopf → helle Variante; ein Feld nur, wenn die
  passende Variante fehlt. Kein Firmenname (steht im Logo, Seitentitel und Alt-Text; ohne Logo steht er da), keine
  Telefonnummer (Kontakt-Karte), keine Linie unter dem Kopf.
- **Leistungen für Bestandskunden (Jamil msgs 3142, 3408):** kleine, dezente Karte am Ende des Portals
  (`components/portal/BestandskundenKarte.svelte`, EIN Baustein für Portal und Vorschau), sobald ein Auftrag des Kunden
  die eingestellte Bedingung erfüllt (ab Auftragsstatus, Standard „abgerechnet“, oder immer – msg 3521; je Kunde abschaltbar;
  `bestandskarte` in `kundenportal-oeffentlich.ts`, Regeln in `lib/bestandskunden.ts`). Der Betrieb stellt sie unter
  Auftrag → Kundenportal & Auftragsbestätigung, Abschnitt „Leistungen für Bestandskunden“ ein (msg 3534; Editor
  `components/portal/BestandskundenEditor.svelte`): an/aus, ab wann, Überschrift, kleiner Text,
  eigene Leistungen (Titel, Kurztext, Symbol, Reihenfolge) und Knöpfe mit Link (nur `https://`, `mailto:`, `tel:`;
  neuer Tab mit `noopener noreferrer`). Gespeichert in `portal_einstellungen` (Migration 107), mit Live-Vorschau.
- Animationen nur dort, wo sie etwas erklären (Fortschrittsweg, Haken der Arbeitsschritte, Pegel), alle mit
  `prefers-reduced-motion` abschaltbar.
- Der Kunde sieht nur Freigegebenes: keine Beschreibungen von Aufgaben, keine internen Aufgaben (ohne
  Lautstärke/Schmutz), Namen nach Einstellung „Namen im Portal“.
- Personen im Portal als gezeichnete Comic-Figur statt Initialen (Jamil msgs 3113/3120): Baustein
  `components/portal/PortalFigur.svelte`, Auswahl `figurFuer` in `lib/portal-figur.ts` – „Ihr persönlicher
  Projektbegleiter“ als Büro-Figur, im Team nach Rolle Monteur/Büro, männlich/weiblich nach Anrede
  (Einstellungen → Benutzer; ohne Anrede männlich). Hausfarbe über `--ui-akzent`. In der App bleiben Initialen.

## 10c. Info-Fenster bei Einstellungen (Jamil msg 3423)

Jede Einstellung erklärt sich selbst: kleines ⓘ (`components/ui/InfoFenster.svelte`) neben Titel, Schalter oder Feld; Tipp/Klick öffnet
ein schwebendes Fenster (Was sie verändert · Wirkt auf · Standard · Beispiel), Esc und Klick daneben schließen, Tippfläche 44 px.
Texte nur in `src/lib/einstellungs-infos.ts`. Seitenweit: `<InfoFenster id="…" beschriftung="Was bewirkt diese Seite?" />` unter dem Seitenkopf.

## 11. Prüfen

- Querscrollen bei 390 px: keins. Tippziele ≥ 44 px.
- Vor dem Commit nach Ausreißern suchen: `grep -rn '<select\|type="radio"\|<fieldset\|style="' src --include=*.svelte`
  – neue Treffer nur mit Begründung.

## 12. Listen-Abzeichen, Belege, Scrollbereiche (Jamil msgs 3522, 3525, 3528)

- **Kleine Abzeichen** (`.ah` / `.ah-chip` in `stil/komponenten.css`): gleiche Optik auf Auftragskarten, Auftragsliste und in der
  Kundenliste (`components/KundenHinweise.svelte`, Regeln in `lib/kunden-zeilen.ts`) – Zeichen + wenig Text, Einzelheiten im Tooltip.
- **Ausgangsbelege** überall mit EINER Zeile: `components/ausgangsbelege/BelegListe.svelte` (Seite „Ausgangsbelege“ und Karte
  „Ausgangsbelege“ am Auftrag). In gemischten Listen steht die Belegart als Abzeichen vor der Nummer (Angebot lila, AB blau,
  Rechnung grün).
- **Lange Listen wie der Verlauf** scrollen in sich: `components/ui/ScrollBereich.svelte` (Höchsthöhe, am Handy höher,
  per Tastatur erreichbar, benannter Bereich). Nicht pro Seite nachbauen.
- **Status ändern** immer mit dem gemeinsamen Status-Menü `components/StatusMenue.svelte` (alle Status mit Farbpunkt, aktueller mit
  Haken, nicht erreichbare ausgegraut mit Grund) – Aufträge und Aufgaben (`stati`), Jamil msg 3568.
- **Einstellungsblöcke** (z. B. Kundenakte „Kundenportal-Einstellungen“ und „Automatik“): Abschnitt mit ⓘ, Feldreihen mit `InfoFeld` +
  `Auswahl`, „Speichern“ oben rechts im Abschnittskopf (`<button form="…">`), Rückmeldung direkt unter dem Kopf (Jamil msg 3558).
- **Auftrag:** „Im Portal sichtbar“ als dezentes Kennzeichen im Kopf (keine eigene Karte, msg 3561); Hauptspalte Aufgaben → Termine →
  Material → Nachkalkulation (msg 3563); keine zweite Terminanzeige (msg 3564); „Dokumentation“ über „Dokumente & Notizen“ (msg 3566).
- **Kundenliste:** Abzeichen auch im Leerzustand (gestrichelt, grau: „Kein Angebot“, „Portal nicht aktiv“ …), Jamil msg 3557.
- **Untergruppen im Auftrags-Board** (Jamil msg 3601): „Anfrage“ → Neu / Termin vereinbart, „Angebot“ → Noch kein Angebot /
  Angebot erhalten – Zwischenüberschriften mit Zahl über `KachelBoard gruppen`, Regeln in `untergruppe()` (`lib/auftrag-board.ts`);
  in der Liste als Kennzeichen neben dem Status. Nur Anzeige, der Status bleibt.

