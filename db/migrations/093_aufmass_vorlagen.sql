-- Aufmaß-Vorlagen (Wunsch Jamil, Talk msg 2842): Vorlagen des Formular-Baukastens mit der Art „aufmass“ – gleiche
-- Technik wie die Protokolle (Versionen, Ausfüllen am Handy, PDF, Bedingungen, Pflichtfelder), dazu Maß-, Flächen-
-- und Formelfelder, wiederholbare Abschnitte (Räume) und Katalog-Verknüpfungen (src/lib/protokoll-formular.ts).
-- Ohne KI-Vorbelegung aus Fotos (Foto-Aufmaß ist entfernt, Migration 086).
alter table app.protokoll_vorlagen add column art text not null default 'protokoll' check (art in ('protokoll', 'aufmass'));
grant insert (art) on app.protokoll_vorlagen to crm_app;
create index protokoll_vorlagen_art_idx on app.protokoll_vorlagen (betrieb_id, art) where aktuell;
