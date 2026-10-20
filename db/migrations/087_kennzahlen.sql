-- Kennzahlen-Cockpit und Zeitmessung je Vorlagen-Aufgabe (Wunsch Jamil, Talk msg 2858).
--
-- 1. „Nacharbeit“ an Zeiteinträgen und Aufgaben (für die Nacharbeitsquote = Nacharbeitsstunden / Gesamtstunden).
-- 2. Aufgaben merken sich, aus welcher Auftrags-Vorlage und welcher Vorlagen-Aufgabe (Titel zum Zeitpunkt des
--    Anlegens) sie stammen. Der Titel ist der Schlüssel, weil die Vorlagen-Aufgaben beim Speichern neu angelegt werden.
-- 3. `begonnen_am`: wann eine Aufgabe zum ersten Mal „In Arbeit“ war (offen mit Fälligkeit, wie auf dem Board) –
--    gesetzt per Trigger, egal über welchen Weg (Board, Liste, Sprache).

alter table app.zeit_eintraege add column nacharbeit boolean not null default false;
grant insert (nacharbeit), update (nacharbeit) on app.zeit_eintraege to crm_app;

alter table app.todos
	add column nacharbeit boolean not null default false,
	add column vorlage_id uuid,
	add column vorlage_aufgabe text check (char_length(vorlage_aufgabe) between 1 and 200),
	add column begonnen_am timestamptz,
	add constraint todos_vorlage_fk foreign key (vorlage_id, betrieb_id) references app.auftrag_vorlagen (id, betrieb_id)
		on delete set null (vorlage_id);
create index todos_vorlage_idx on app.todos (vorlage_id, betrieb_id) where vorlage_id is not null;

grant insert (nacharbeit, vorlage_id, vorlage_aufgabe), update (nacharbeit) on app.todos to crm_app;

create function app.todo_begonnen() returns trigger language plpgsql as $$
begin
	if new.begonnen_am is null and new.faellig is not null and new.erledigt_am is null then
		new.begonnen_am := now();
	end if;
	-- Direkt erledigt, ohne je „In Arbeit“ gewesen zu sein: Beginn = Anlegen (Bearbeitungszeit = ganze Dauer)
	if new.begonnen_am is null and new.erledigt_am is not null then
		new.begonnen_am := new.angelegt;
	end if;
	return new;
end $$;

create trigger todos_begonnen before insert or update of faellig, erledigt_am on app.todos
	for each row execute function app.todo_begonnen();

-- Bestehende Aufgaben: Beginn bestmöglich nachtragen (erledigt → Anlegen; offen mit Fälligkeit → Anlegen) –
-- ohne Einträge im Verlauf und ohne „geändert“-Zeitstempel bzw. Erinnerungen anzufassen
alter table app.todos disable trigger todos_protokoll;
alter table app.todos disable trigger todos_geaendert;
alter table app.todos disable trigger todos_erinnerungen;
update app.todos set begonnen_am = angelegt where begonnen_am is null and (erledigt_am is not null or faellig is not null);
alter table app.todos enable trigger todos_protokoll;
alter table app.todos enable trigger todos_geaendert;
alter table app.todos enable trigger todos_erinnerungen;
