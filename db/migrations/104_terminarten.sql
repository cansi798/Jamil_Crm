-- Terminarten (Jamil msg 3074): Die bisherigen „Dienste“ der Online-Buchung sind jetzt EINE gepflegte Liste der
-- Terminarten je Betrieb. Sie gelten in der Plantafel (Einsatz anlegen/bearbeiten) und – nur wenn „Online buchbar“ –
-- auf der öffentlichen Buchungsseite. Die Tabelle heißt weiter app.buchung_dienste (Umbenennen wäre riskant: viele
-- Fremdschlüssel, Funktionen und laufende Arbeiten hängen daran); in der Oberfläche heißt sie überall „Terminart“.
--
-- * buchung_dienste.online_buchbar: nur diese erscheinen in der Online-Buchung. Bestehende Dienste bleiben buchbar.
-- * einsaetze.terminart_id: optionale Terminart eines Einsatzes (leer = keine). Wird die Terminart gelöscht, bleibt der
--   Einsatz und verliert nur die Terminart.
-- * app.buchung_link_aufloesen: löst nur noch Links online buchbarer Terminarten auf.
-- * app.testdaten_buchungen_loeschen: Aufräumen nach Browser-Tests (nur im Testmodus aufgerufen, siehe
--   src/routes/api/testmodus/aufraeumen) – löscht Buchungen ausschließlich von Terminarten, deren Name mit „E2E “
--   beginnt, und nur im eigenen Betrieb. Buchungen echter Terminarten löscht weiterhin niemand.

alter table app.buchung_dienste add column online_buchbar boolean not null default true;
grant insert (online_buchbar), update (online_buchbar) on app.buchung_dienste to crm_app;

alter table app.einsaetze add column terminart_id uuid,
	add constraint einsaetze_terminart_fk foreign key (terminart_id, betrieb_id)
		references app.buchung_dienste (id, betrieb_id) on delete set null (terminart_id);
create index einsaetze_terminart_idx on app.einsaetze (terminart_id, betrieb_id) where terminart_id is not null;
grant insert (terminart_id), update (terminart_id) on app.einsaetze to crm_app;

-- Einsätze aus Online-Buchungen bekommen ihre Terminart
update app.einsaetze e set terminart_id = b.dienst_id
from app.buchungen b
where b.einsatz_id = e.id and b.betrieb_id = e.betrieb_id and e.terminart_id is null;

create or replace function app.buchung_link_aufloesen(p_token text)
returns table (link_id uuid, betrieb_id uuid)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select l.id, l.betrieb_id
	from app.buchung_links l
	join app.buchung_dienste d on d.id = l.dienst_id and d.betrieb_id = l.betrieb_id
	join app.betriebe b on b.id = l.betrieb_id
	join app.tarife t on t.id = b.tarif_id
	where p_token ~ '^[A-Za-z0-9_-]{32,64}$' and l.token = p_token and l.aktiv and d.aktiv and d.online_buchbar
		and b.abo_status in ('test', 'aktiv') and t.module @> array['auftraege', 'plantafel']::text[]
$$;
revoke all on function app.buchung_link_aufloesen(text) from public, crm_app, crm_admin;
grant execute on function app.buchung_link_aufloesen(text) to crm_auth;

-- Aufräumen nach Browser-Tests: Buchungen einer Test-Terminart („E2E …“) im eigenen Betrieb löschen.
create function app.testdaten_buchungen_loeschen(p_dienst uuid)
returns integer
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_betrieb uuid := nullif(current_setting('app.betrieb_id', true), '')::uuid;
	v_anzahl integer;
begin
	if v_betrieb is null then
		raise exception 'kein Betrieb';
	end if;
	if not exists (select 1 from app.buchung_dienste where id = p_dienst and betrieb_id = v_betrieb and name like 'E2E %') then
		raise exception 'nur Test-Terminarten (Name beginnt mit „E2E “)';
	end if;
	delete from app.buchungen where dienst_id = p_dienst and betrieb_id = v_betrieb;
	get diagnostics v_anzahl = row_count;
	return v_anzahl;
end;
$$;
revoke all on function app.testdaten_buchungen_loeschen(uuid) from public, crm_admin, crm_auth;
grant execute on function app.testdaten_buchungen_loeschen(uuid) to crm_app;

-- Recht heißt jetzt „Terminarten und Online-Buchung verwalten“ (Beschriftung im Code, der Schlüssel bleibt)
