-- Zeiterfassung: Änderungen von Jamil (msgs 2790, 2795).
--
-- 1. „Tätigkeiten ohne Auftrag“ fallen komplett weg (msg 2790): Jede Zeit gehört zu einem Auftrag. Vorhandene Zeiten
--    ohne Auftrag (nur Vorschau-/Testdaten) werden gelöscht, die Spalte taetigkeit_id und die Tabelle
--    zeit_taetigkeiten entfernt. auftrag_id ist Pflicht; wird ein Auftrag gelöscht (nur als Anfrage möglich),
--    fallen seine Zeiten mit.
-- 2. Rechte heißen jetzt „zeiterfassung.nutzen“ (eigene Zeiten, Standard für Monteur/Chef/Büro) und
--    „zeiterfassung.alle_sehen“ (Zeiten aller, Chef/Büro) – in Rollen frei vergebbar (msg 2795).

delete from app.zeit_eintraege where auftrag_id is null or taetigkeit_id is not null;

alter table app.zeit_eintraege drop column taetigkeit_id;
drop table app.zeit_taetigkeiten;

alter table app.zeit_eintraege drop constraint zeit_eintraege_auftrag_id_betrieb_id_fkey;
alter table app.zeit_eintraege alter column auftrag_id set not null;
alter table app.zeit_eintraege add constraint zeit_eintraege_auftrag_id_betrieb_id_fkey
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade;

update app.rollen set rechte = array_replace(rechte, 'zeiten.erfassen', 'zeiterfassung.nutzen') where 'zeiten.erfassen' = any (rechte);
update app.rollen set rechte = array_replace(rechte, 'zeiten.verwalten', 'zeiterfassung.alle_sehen') where 'zeiten.verwalten' = any (rechte);
-- Standard laut msg 2795: Monteur, Chef und Büro nutzen die Zeiterfassung; Chef und Büro sehen alle
update app.rollen set rechte = array_append(rechte, 'zeiterfassung.nutzen')
where vorlage in ('monteur', 'chef', 'buero') and not ('zeiterfassung.nutzen' = any (rechte));
update app.rollen set rechte = array_append(rechte, 'zeiterfassung.alle_sehen')
where vorlage in ('chef', 'buero') and not ('zeiterfassung.alle_sehen' = any (rechte));
