-- Auftragsquellen (Wunsch Jamil msgs 2670/2672): Farbe je Eintrag für die farbigen Etiketten in der Auftragsübersicht
-- (Board-Karten und Liste); in Einstellungen → Auftragsquellen wählbar. Startliste bekommt passende Vorgaben.

alter table app.auftrag_quellen add column farbe text not null default '#8a8886'
	check (farbe ~ '^#[0-9a-f]{6}$');
grant insert (farbe) on app.auftrag_quellen to crm_app;
grant update (farbe) on app.auftrag_quellen to crm_app;

update app.auftrag_quellen set farbe = case lower(btrim(name))
	when 'website' then '#0f6cbd'
	when 'hornbach' then '#e8730c'
	when 'obi' then '#c50f1f'
	when 'empfehlung' then '#107c10'
	when 'zeitung' then '#605e5c'
	when 'myhammer' then '#8764b8'
	when 'telefon' then '#038387'
	else '#8a8886' end;
