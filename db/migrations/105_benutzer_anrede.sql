-- Anrede der Mitarbeiter (Jamil msg 3113): Im Kundenportal stehen statt Anfangsbuchstaben gezeichnete Comic-Figuren –
-- je eine für Ansprechpartner/Ansprechpartnerin und Monteur/Monteurin. Welche Figur jemand bekommt, hängt an dieser
-- Anrede (Einstellungen → Benutzer). Leer = nicht angegeben → männliche Standardfigur.

alter table app.benutzer add column anrede text check (anrede in ('herr', 'frau'));
-- crm_app hat auf app.benutzer nur Spaltenrechte (Migration 003): neue Spalte ausdrücklich freigeben.
grant select (anrede), update (anrede) on app.benutzer to crm_app;
