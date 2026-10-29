-- Partner als Auftragsquelle (Jamil, Talk msg 3707): Jeder Auftraggeber-Partner hat automatisch eine zugehörige
-- Auftragsquelle (Verknüpfung über auftrag_quellen.partner_id aus Migration 094), neu angelegt AUSGESCHALTET.
-- * Zeigt schon eine Quelle auf den Partner, entsteht keine zweite (ihr aktiv-Status bleibt).
-- * Gibt es eine gleichnamige Quelle ohne Partner (z. B. „Hornbach“ aus der Startliste), wird DIESE mit dem Partner
--   verknüpft (aktiv bleibt, wie er ist) – statt einer zweiten „Hornbach“. Ist der Name schon vergeben, heißt die neue
--   Quelle „<Name> (Partner)“.
-- * Partner umbenannt → Quellname zieht mit, solange er noch dem alten Partnernamen entspricht und der neue Name frei ist
--   (eine von Hand umbenannte Quelle bleibt, wie sie ist).
-- * Partner ausgeschaltet (auch „Löschen“ eines benutzten Partners = ausschalten) → seine Quellen werden mit
--   ausgeschaltet; Einschalten des Partners schaltet die Quelle NICHT automatisch wieder ein. Partner wirklich gelöscht
--   (nur unbenutzte) → Quelle wird ausgeschaltet und verliert die Verknüpfung (FK „set null“), ist danach eine normale
--   Quelle. Aufträge behalten ihre Quelle immer.
-- * Quellen, die zu einem (noch vorhandenen) Partner gehören, lassen sich nicht löschen – nur aus- und einschalten.
-- Alles innerhalb des eigenen Betriebs (RLS wie gehabt, Trigger laufen mit den Rechten der Anwendung).

create function app.partner_quelle_sicherstellen(p_partner uuid, p_betrieb uuid, p_name text) returns void language plpgsql as $$
declare v_id uuid; v_name text; v_nr integer;
begin
	if exists (select 1 from app.auftrag_quellen where partner_id = p_partner and betrieb_id = p_betrieb) then return; end if;
	select id into v_id from app.auftrag_quellen
	where betrieb_id = p_betrieb and partner_id is null and lower(btrim(name)) = lower(btrim(p_name))
	limit 1;
	if v_id is not null then
		update app.auftrag_quellen set partner_id = p_partner where id = v_id and betrieb_id = p_betrieb;
		return;
	end if;
	v_name := left(btrim(p_name), 100);
	if exists (select 1 from app.auftrag_quellen where betrieb_id = p_betrieb and lower(btrim(name)) = lower(v_name)) then
		v_name := left(btrim(p_name), 89) || ' (Partner)';
	end if;
	if exists (select 1 from app.auftrag_quellen where betrieb_id = p_betrieb and lower(btrim(name)) = lower(v_name)) then
		v_name := left(btrim(p_name), 80) || ' (Partner ' || left(p_partner::text, 4) || ')';
	end if;
	select coalesce(max(sortierung), 0) + 1 into v_nr from app.auftrag_quellen where betrieb_id = p_betrieb;
	insert into app.auftrag_quellen (betrieb_id, name, aktiv, sortierung, partner_id) values (p_betrieb, v_name, false, v_nr, p_partner);
end $$;
revoke all on function app.partner_quelle_sicherstellen(uuid, uuid, text) from public;
grant execute on function app.partner_quelle_sicherstellen(uuid, uuid, text) to crm_app;

create function app.partner_quelle_anlegen() returns trigger language plpgsql as $$
begin
	if new.art = 'auftraggeber' then perform app.partner_quelle_sicherstellen(new.id, new.betrieb_id, new.name); end if;
	return null;
end $$;
create trigger partner_quelle_anlegen after insert or update of art on app.partner
	for each row execute function app.partner_quelle_anlegen();

create function app.partner_quelle_mitziehen() returns trigger language plpgsql as $$
begin
	if tg_op = 'DELETE' then
		update app.auftrag_quellen set aktiv = false where partner_id = old.id and betrieb_id = old.betrieb_id and aktiv;
		return old;
	end if;
	if new.aktiv is distinct from old.aktiv and not new.aktiv then
		update app.auftrag_quellen set aktiv = false where partner_id = new.id and betrieb_id = new.betrieb_id and aktiv;
	end if;
	if btrim(new.name) is distinct from btrim(old.name) then
		update app.auftrag_quellen q set name = left(btrim(new.name), 100)
		where q.partner_id = new.id and q.betrieb_id = new.betrieb_id and lower(btrim(q.name)) = lower(left(btrim(old.name), 100))
			and not exists (select 1 from app.auftrag_quellen x where x.betrieb_id = q.betrieb_id and x.id <> q.id
				and lower(btrim(x.name)) = lower(left(btrim(new.name), 100)));
	end if;
	return new;
end $$;
create trigger partner_quelle_aendern after update of aktiv, name on app.partner
	for each row execute function app.partner_quelle_mitziehen();
create trigger partner_quelle_loeschen before delete on app.partner
	for each row execute function app.partner_quelle_mitziehen();

-- Löschschutz: Quelle eines vorhandenen Partners nicht löschbar. Beim Löschen eines ganzen Betriebs (Kaskade) greift er
-- nicht – dann ist der Betrieb schon weg. SECURITY DEFINER nur für diese Prüfung (Sichtbarkeit unabhängig von RLS).
create function app.partner_quelle_schuetzen() returns trigger language plpgsql security definer set search_path = app, pg_temp as $$
begin
	if old.partner_id is not null
		and exists (select 1 from app.betriebe where id = old.betrieb_id)
		and exists (select 1 from app.partner where id = old.partner_id and betrieb_id = old.betrieb_id) then
		raise exception 'Auftragsquelle gehört zu einem Partner – nur aus- oder einschalten' using errcode = 'P0001';
	end if;
	return old;
end $$;
revoke all on function app.partner_quelle_schuetzen() from public;
create trigger auftrag_quellen_partner_schutz before delete on app.auftrag_quellen
	for each row execute function app.partner_quelle_schuetzen();

-- Nachholen für vorhandene Auftraggeber-Partner ohne Quelle (gleiche Regeln wie der Trigger, neue Quellen ausgeschaltet)
select app.partner_quelle_sicherstellen(p.id, p.betrieb_id, p.name)
from app.partner p where p.art = 'auftraggeber' order by p.betrieb_id, p.angelegt, p.id;
