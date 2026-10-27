-- Leistungen für Bestandskunden im Kundenportal (Wunsch Jamil, Talk msg 3408): Der Betrieb stellt selbst ein, ob die
-- Karte nach Abschluss eines Auftrags erscheint, wie sie heißt, welcher kurze Text und welche Leistungen darin stehen
-- und welche Knöpfe mit welchen Links es gibt. Je Betrieb eine Einstellung (portal_einstellungen).
--
-- * bestand_aktiv: Karte an/aus (Standard an – wie bisher).
-- * bestand_titel / bestand_text: leer (NULL) = Standardtext der Anwendung.
-- * bestand_leistungen: Liste [{titel, text, symbol}], NULL = Standardliste; [] = bewusst keine Leistungen.
-- * bestand_knoepfe: Liste [{text, url}] – die Anwendung lässt nur https://, mailto: und tel: zu, hier sichert die
--   Datenbank zusätzlich ab: nur Liste, höchstens 10 bzw. 4 Einträge.
-- Keine Datenänderung nötig: ohne Zeile in portal_einstellungen gelten die Standardwerte.

alter table app.portal_einstellungen
	add column if not exists bestand_aktiv boolean not null default true,
	add column if not exists bestand_titel text check (bestand_titel is null or char_length(bestand_titel) between 1 and 60),
	add column if not exists bestand_text text check (bestand_text is null or char_length(bestand_text) <= 240),
	add column if not exists bestand_leistungen jsonb
		check (bestand_leistungen is null or (jsonb_typeof(bestand_leistungen) = 'array' and jsonb_array_length(bestand_leistungen) <= 10)),
	add column if not exists bestand_knoepfe jsonb
		check (bestand_knoepfe is null or (jsonb_typeof(bestand_knoepfe) = 'array' and jsonb_array_length(bestand_knoepfe) <= 4));

grant insert (bestand_aktiv, bestand_titel, bestand_text, bestand_leistungen, bestand_knoepfe) on app.portal_einstellungen to crm_app;
grant update (bestand_aktiv, bestand_titel, bestand_text, bestand_leistungen, bestand_knoepfe) on app.portal_einstellungen to crm_app;
