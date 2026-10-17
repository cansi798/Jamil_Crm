-- Sprachsteuerung und KI (Stufe 1d): Zählung der KI-Anfragen je Betrieb und Kalendermonat (Europe/Berlin) gegen
-- grenzen.ki_pro_monat des Tarifs. Die Herkunft einer Änderung („sprache“) steht seit 006 in app.aenderungen.quelle
-- (Trigger app.protokolliere übernimmt die Sitzungsvariable app.quelle) – dafür ist hier nichts mehr nötig.
--
-- Gezählt wird ausschließlich über app.ki_verbrauche() (SECURITY DEFINER): Die Funktion liest die Grenze selbst aus
-- dem Tarif und erhöht atomar (eine Zeile je Betrieb und Monat, Sperre über ON CONFLICT). crm_app darf die Zeilen nur
-- lesen (eigener Betrieb), nie direkt einfügen, ändern oder löschen – das Kontingent lässt sich so nicht zurückdrehen.

create table app.ki_nutzung (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- erster Tag des Kalendermonats in Berlin
	monat date not null check (extract(day from monat) = 1),
	anzahl integer not null default 0 check (anzahl >= 0),
	geaendert timestamptz not null default now(),
	primary key (betrieb_id, monat)
);

revoke all on app.ki_nutzung from public, crm_app, crm_admin, crm_auth;
grant select on app.ki_nutzung to crm_app;

alter table app.ki_nutzung enable row level security;
alter table app.ki_nutzung force row level security;

create policy ki_nutzung_lesen on app.ki_nutzung
	for select to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Verbraucht eine KI-Anfrage des Betriebs aus app.betrieb_id. Rückgabe: neuer Zählerstand – oder NULL, wenn die
-- Grenze erreicht ist (dann wird nichts gezählt). Fail closed: ohne Betriebskontext 42501; fehlt die Grenze im Tarif
-- oder ist sie keine Zahl ≥ 0, bricht die Funktion ab (22023) – „unbegrenzt“ gibt es nur ausdrücklich als JSON null.
create function app.ki_verbrauche()
returns integer
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_betrieb uuid;
	v_grenze jsonb;
	v_hat_grenze boolean;
	v_limit numeric;
	v_monat date := date_trunc('month', now() at time zone 'Europe/Berlin')::date;
	v_anzahl integer;
begin
	begin
		v_betrieb := nullif(current_setting('app.betrieb_id', true), '')::uuid;
	exception when invalid_text_representation then
		raise exception 'ki_verbrauche: app.betrieb_id ist keine UUID' using errcode = '42501';
	end;
	if v_betrieb is null then
		raise exception 'ki_verbrauche: kein Betriebskontext' using errcode = '42501';
	end if;
	select t.grenzen -> 'ki_pro_monat', t.grenzen ? 'ki_pro_monat'
		into v_grenze, v_hat_grenze
		from app.betriebe b join app.tarife t on t.id = b.tarif_id
		where b.id = v_betrieb;
	if not found then
		raise exception 'ki_verbrauche: Betrieb nicht gefunden' using errcode = '42501';
	end if;
	if not coalesce(v_hat_grenze, false) then
		raise exception 'ki_verbrauche: Tarif hat keine Grenze ki_pro_monat' using errcode = '22023';
	end if;
	if jsonb_typeof(v_grenze) = 'null' then
		insert into app.ki_nutzung as n (betrieb_id, monat, anzahl) values (v_betrieb, v_monat, 1)
			on conflict (betrieb_id, monat) do update set anzahl = n.anzahl + 1, geaendert = now()
			returning n.anzahl into v_anzahl;
		return v_anzahl;
	end if;
	if jsonb_typeof(v_grenze) <> 'number' or (v_grenze #>> '{}')::numeric < 0 then
		raise exception 'ki_verbrauche: ungültige Grenze ki_pro_monat' using errcode = '22023';
	end if;
	v_limit := floor((v_grenze #>> '{}')::numeric);
	if v_limit < 1 then
		return null;
	end if;
	insert into app.ki_nutzung as n (betrieb_id, monat, anzahl) values (v_betrieb, v_monat, 1)
		on conflict (betrieb_id, monat) do update set anzahl = n.anzahl + 1, geaendert = now()
			where n.anzahl < v_limit
		returning n.anzahl into v_anzahl;
	return v_anzahl;
end;
$$;

revoke execute on function app.ki_verbrauche() from public, crm_admin, crm_auth;
grant execute on function app.ki_verbrauche() to crm_app;
