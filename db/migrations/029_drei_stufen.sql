-- Wünsche Jamil (msgs 2485, 2486): „Lieber generell nur 3 Stufen für Lautstärke und Schmutz“ (1 gering, 2 mittel,
-- 3 hoch) – und beides auch je To-do in den Auftrags-Vorlagen.
--
-- Bestehende Werte 1–5 → 1–3: 1–2 → 1 (gering), 3 → 2 (mittel), 4–5 → 3 (hoch).

alter table app.todos drop constraint todos_lautstaerke_check;
alter table app.todos drop constraint todos_schmutz_check;
update app.todos set
	lautstaerke = case when lautstaerke is null then null when lautstaerke <= 2 then 1 when lautstaerke = 3 then 2 else 3 end,
	schmutz = case when schmutz is null then null when schmutz <= 2 then 1 when schmutz = 3 then 2 else 3 end
where lautstaerke is not null or schmutz is not null;
alter table app.todos
	add constraint todos_lautstaerke_check check (lautstaerke between 1 and 3),
	add constraint todos_schmutz_check check (schmutz between 1 and 3);

alter table app.auftrag_vorlagen_todos
	add column lautstaerke smallint check (lautstaerke between 1 and 3),
	add column schmutz smallint check (schmutz between 1 and 3);
grant insert (lautstaerke, schmutz) on app.auftrag_vorlagen_todos to crm_app;
grant update (lautstaerke, schmutz) on app.auftrag_vorlagen_todos to crm_app;
