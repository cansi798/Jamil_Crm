-- Kundenportal im Handwerks-Design (Jamil msgs 2848, 2851): Der Kunde sieht seinen Ansprechpartner und die Namen der
-- Mitarbeiter am Auftrag. Wie die Namen erscheinen, legt der Betrieb fest:
--   'vorname' (Standard, wie bisher), 'voll' (Vor- und Nachname) oder 'aus' (keine Namen).
-- Je Auftrag bleibt zusätzlich der Schalter „Namen der Mitarbeiter“ (portal_auftrag.mitarbeiter).

alter table app.portal_einstellungen
	add column if not exists team_namen text not null default 'vorname' check (team_namen in ('vorname', 'voll', 'aus'));
grant insert (team_namen) on app.portal_einstellungen to crm_app;
grant update (team_namen) on app.portal_einstellungen to crm_app;
