-- Nachtrag zu 040: Ältere Chef-/Büro-Rollen (angelegt, bevor es „Protokolle bearbeiten“ gab) bekamen dort das Recht
-- „Protokoll-Vorlagen gestalten“ nicht. Chef und Büro (Vorlage chef/buero) sowie jede Rolle mit „Einstellungen“
-- gestalten Vorlagen.
update app.rollen set rechte = array_append(rechte, 'protokolle.vorlagen_bearbeiten')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte))
	and not ('protokolle.vorlagen_bearbeiten' = any (rechte));
