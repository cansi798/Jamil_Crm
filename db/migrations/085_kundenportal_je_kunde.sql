-- Kundenportal gehört dem KUNDEN, nicht einem Auftrag (Wunsch Jamil msg 2793).
--
-- * Ein Portal-Link je Kunde (verwaltet auf der Kundenseite); das Portal zeigt alle freigegebenen Aufträge des Kunden.
-- * Regel in den Einstellungen: „alle aktiven Aufträge“ (Standard; aktiv = nicht abgerechnet) oder „nur Aufträge mit
--   ‚im Portal zeigen‘“; je Auftrag überschreibbar (portal_auftrag.sichtbar: leer = Regel, ja/nein).
-- * Bisherige Links je Auftrag werden zu Links des Kunden (der Auftrag wird dabei ausdrücklich sichtbar); Links von
--   Aufträgen ohne Kunden (Einmal-Kunde) werden widerrufen.
-- * Neues Recht „kundenportal.verwalten“ (Chef und Büro).

alter table app.portal_einstellungen
	add column standard text not null default 'alle_aktiven' check (standard in ('alle_aktiven', 'nur_markierte'));
grant insert (standard) on app.portal_einstellungen to crm_app;
grant update (standard) on app.portal_einstellungen to crm_app;

alter table app.portal_auftrag add column sichtbar boolean;
grant insert (sichtbar) on app.portal_auftrag to crm_app;
grant update (sichtbar) on app.portal_auftrag to crm_app;

-- Aufträge mit bisherigem eigenem Link: ausdrücklich im Portal sichtbar
insert into app.portal_auftrag (auftrag_id, betrieb_id, sichtbar)
select distinct l.auftrag_id, l.betrieb_id, true from app.portal_links l
where l.auftrag_id is not null and l.widerrufen_am is null
on conflict (auftrag_id) do update set sichtbar = true;

update app.portal_links l set kunde_id = a.kunde_id, auftrag_id = null
from app.auftraege a
where l.auftrag_id = a.id and l.betrieb_id = a.betrieb_id and a.kunde_id is not null;

update app.portal_links set widerrufen_am = now() where auftrag_id is not null and widerrufen_am is null;

update app.rollen set rechte = array_append(rechte, 'kundenportal.verwalten')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte)) and not ('kundenportal.verwalten' = any (rechte));
