-- Eigener Termin (Wunsch Jamil msg 2682): Kalendereintrag ohne Auftrag, z. B. „Zahnarzt Freitag 9 Uhr“ – mit Titel
-- statt Auftrag. Erscheint im Kalender der Person (und auf der Plantafel), kann Erinnerungen haben.

alter table app.einsaetze alter column auftrag_id drop not null;
alter table app.einsaetze add column titel text check (char_length(btrim(titel)) between 1 and 200);
alter table app.einsaetze add constraint einsaetze_auftrag_oder_titel check (auftrag_id is not null or titel is not null);
grant insert (titel) on app.einsaetze to crm_app;
grant update (titel) on app.einsaetze to crm_app;
