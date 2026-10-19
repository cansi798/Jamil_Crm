-- To-dos mit Beschreibung (19.10.2026).
--
-- Auftrags-To-do-Vorlagen (020) haben je To-do eine Beschreibung; beim Anwenden ging sie bisher verloren, weil
-- app.todos keine Spalte dafür hatte. Gleiche Grenze wie in der Vorlage (500 Zeichen).
--
-- angelegt: clock_timestamp() statt now() – mehrere To-dos aus einer Vorlage entstehen in EINER Transaktion; mit
-- now() hätten sie denselben Zeitpunkt, und die Liste (sortiert nach angelegt) verlöre die Reihenfolge der Vorlage.

alter table app.todos add column beschreibung text;
alter table app.todos add constraint todos_beschreibung_laenge check (char_length(beschreibung) <= 500);
alter table app.todos alter column angelegt set default clock_timestamp();

grant insert (beschreibung) on app.todos to crm_app;
grant update (beschreibung) on app.todos to crm_app;
