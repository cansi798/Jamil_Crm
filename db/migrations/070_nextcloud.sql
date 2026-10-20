-- Nextcloud-Anbindung (optional, Entscheidung Can msg 2748: CRM bleibt eigenständig, Nextcloud wird angebunden).
-- Ohne NEXTCLOUD_URL in der Umgebung bleibt alles hier ungenutzt.
--
-- 1. app.nextcloud_konten: welcher CRM-Benutzer zu welchem Nextcloud-Konto gehört (für „Mit Nextcloud anmelden“,
--    Kalender und Talk-Benachrichtigungen). Ein Nextcloud-Konto gehört zu höchstens einem CRM-Benutzer und umgekehrt.
-- 2. app.nextcloud_abgleich: was schon in Nextcloud liegt (Kalendereinträge, Kontakte, Dateien) mit Prüfsumme –
--    so ist der Abgleich wiederholbar (gleiche UID/Pfad = Überschreiben statt Duplikat) und Löschungen werden erkannt.
-- Beide Tabellen enthalten keine Geheimnisse (Zugangsdaten stehen nur in der .env).

create table app.nextcloud_konten (
	-- id nur fürs Änderungsprotokoll (app.protokolliere braucht id + betrieb_id)
	id uuid not null default gen_random_uuid() unique,
	benutzer_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- Nextcloud-Benutzername (= „sub“ im ID-Token der Nextcloud-App „OIDC Identity Provider“)
	nc_benutzer text not null check (char_length(nc_benutzer) between 1 and 64),
	nc_email text check (char_length(nc_email) <= 254),
	-- 'admin' = vom Admin im CRM verknüpft, 'email' = bei der ersten Anmeldung über die bestätigte E-Mail
	art text not null check (art in ('admin', 'email')),
	verknuepft_am timestamptz not null default now(),
	verknuepft_von uuid,
	zuletzt_angemeldet timestamptz,
	unique (nc_benutzer),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index nextcloud_konten_betrieb_idx on app.nextcloud_konten (betrieb_id);

create table app.nextcloud_abgleich (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- 'termin' (Einsatz im Kalender einer Person), 'kontakt' (Kunde), 'datei' (Foto/Protokoll-PDF), 'angebot' (PDF)
	art text not null check (art in ('termin', 'kontakt', 'datei', 'angebot')),
	objekt_id uuid not null,
	-- bei Terminen: wessen Kalender (eine Einsatz-ID kann nur einer Person gehören, wechselt aber evtl.)
	benutzer_id uuid,
	-- Ziel in Nextcloud (relativer DAV-Pfad); bei Löschung/Umbenennung wird der alte Pfad entfernt
	ziel text not null check (char_length(ziel) <= 2000),
	pruefsumme text not null check (char_length(pruefsumme) <= 100),
	aktualisiert timestamptz not null default now(),
	primary key (betrieb_id, art, objekt_id)
);

revoke all on app.nextcloud_konten, app.nextcloud_abgleich from public, crm_app, crm_admin, crm_auth;
-- Admins im Betrieb (Recht benutzer.verwalten, geprüft in der Anwendung) verknüpfen und lösen
grant select, delete on app.nextcloud_konten to crm_app;
grant insert (benutzer_id, betrieb_id, nc_benutzer, nc_email, art, verknuepft_von) on app.nextcloud_konten to crm_app;
grant select, insert, update, delete on app.nextcloud_abgleich to crm_app;

alter table app.nextcloud_konten enable row level security;
alter table app.nextcloud_konten force row level security;
alter table app.nextcloud_abgleich enable row level security;
alter table app.nextcloud_abgleich force row level security;

create policy nextcloud_konten_mandant on app.nextcloud_konten
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy nextcloud_abgleich_mandant on app.nextcloud_abgleich
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Verknüpfungen sind sicherheitsrelevant (wer sich womit anmelden darf) → Änderungsprotokoll
create trigger nextcloud_konten_protokoll
	after insert or update or delete on app.nextcloud_konten
	for each row execute function app.protokolliere('zuletzt_angemeldet');

-- Anmeldung über Nextcloud: CRM-Benutzer zum (bereits geprüften) ID-Token finden.
-- 1. Verknüpfung über den Nextcloud-Benutzernamen (sub).
-- 2. Sonst – nur wenn p_per_email und die E-Mail von Nextcloud als bestätigt gemeldet wurde – ein vorhandener,
--    aktiver CRM-Benutzer mit genau dieser E-Mail, der noch kein Nextcloud-Konto hat: Verknüpfung wird angelegt.
--    Es wird NIE ein CRM-Benutzer angelegt.
-- Nur Benutzer des Betriebs p_betrieb (die Anbindung gehört zu genau einem Betrieb); Plattform-Admins nie.
create function app.nextcloud_konto_finden(
	p_betrieb uuid, p_sub text, p_email text, p_email_bestaetigt boolean, p_per_email boolean
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_benutzer uuid;
begin
	if p_sub is null or char_length(p_sub) not between 1 and 64 then
		return null;
	end if;
	select k.benutzer_id into v_benutzer
	from app.nextcloud_konten k
	join app.benutzer b on b.id = k.benutzer_id
	where k.nc_benutzer = p_sub and k.betrieb_id = p_betrieb and b.aktiv;
	if v_benutzer is null and p_per_email and p_email_bestaetigt and p_email is not null and p_email <> '' then
		select b.id into v_benutzer
		from app.benutzer b
		where b.email operator(public.=) p_email::public.citext
			and b.betrieb_id = p_betrieb
			and b.aktiv
			and not exists (select 1 from app.nextcloud_konten k where k.benutzer_id = b.id)
			and not exists (select 1 from app.nextcloud_konten k where k.nc_benutzer = p_sub);
		if v_benutzer is not null then
			insert into app.nextcloud_konten (benutzer_id, betrieb_id, nc_benutzer, nc_email, art)
			values (v_benutzer, p_betrieb, p_sub, left(p_email, 254), 'email');
		end if;
	end if;
	if v_benutzer is null or exists (select 1 from app.plattform_admins pa where pa.benutzer_id = v_benutzer) then
		return null;
	end if;
	update app.nextcloud_konten set zuletzt_angemeldet = now() where benutzer_id = v_benutzer;
	return v_benutzer;
end;
$$;

-- Volle Sitzung nach Nextcloud-Anmeldung, wenn die Installation der Zwei-Faktor-Prüfung von Nextcloud vertraut
-- (NEXTCLOUD_2FA_VERTRAUEN=ja). Nur für verknüpfte, aktive Benutzer eines nicht gesperrten Betriebs; die Sitzung
-- zählt als „mit zweitem Faktor“ (sitzung_pruefen verlangt das für Konten mit Pflicht-2FA). Ohne Vertrauen nimmt
-- die Anwendung stattdessen app.anmeldung_weiter (CRM-eigener Code).
create function app.nextcloud_sitzung(p_benutzer uuid, p_hash bytea, p_ablauf timestamptz)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
	if not exists (
		select 1
		from app.benutzer b
		join app.nextcloud_konten k on k.benutzer_id = b.id
		join app.betriebe bt on bt.id = b.betrieb_id
		where b.id = p_benutzer and b.aktiv and bt.abo_status <> 'gesperrt'
	) or exists (select 1 from app.plattform_admins pa where pa.benutzer_id = p_benutzer) then
		return false;
	end if;
	delete from app.sitzungen s where s.benutzer_id = p_benutzer and s.laeuft_ab <= now();
	insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
	values (p_hash, p_benutzer, p_ablauf, true);
	return true;
end;
$$;

-- Hintergrund-Abgleich: alle verknüpften, aktiven Konten eines Betriebs (für Kalender und Talk), dazu ein
-- Dienst-Kontext (ältester aktiver Benutzer mit Recht „einstellungen“) für betriebsweite Daten (Kontakte, Dateien).
create function app.nextcloud_verknuepfte(p_betrieb uuid)
returns table (benutzer_id uuid, nc_benutzer text, name text)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select k.benutzer_id, k.nc_benutzer, b.name
	from app.nextcloud_konten k join app.benutzer b on b.id = k.benutzer_id
	where k.betrieb_id = p_betrieb and b.aktiv
	order by b.name;
$$;

create function app.nextcloud_dienst_kontext(p_betrieb uuid)
returns uuid
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select b.id from app.benutzer b
	join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
	join app.betriebe bt on bt.id = b.betrieb_id
	where b.betrieb_id = p_betrieb and b.aktiv and 'einstellungen' = any (r.rechte) and bt.abo_status <> 'gesperrt'
	order by b.id
	limit 1;
$$;

-- Ohne NEXTCLOUD_BETRIEB: Anbindung nur, wenn es genau einen Betrieb gibt (Einzelbetrieb auf eigenem Server).
create function app.einziger_betrieb()
returns uuid
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select case when count(*) = 1 then min(id::text)::uuid end from app.betriebe;
$$;

revoke all on function app.nextcloud_konto_finden(uuid, text, text, boolean, boolean) from public, crm_app, crm_admin;
revoke all on function app.nextcloud_sitzung(uuid, bytea, timestamptz) from public, crm_app, crm_admin;
revoke all on function app.nextcloud_verknuepfte(uuid) from public, crm_app, crm_admin;
revoke all on function app.nextcloud_dienst_kontext(uuid) from public, crm_app, crm_admin;
revoke all on function app.einziger_betrieb() from public, crm_app, crm_admin;
grant execute on function app.nextcloud_konto_finden(uuid, text, text, boolean, boolean) to crm_auth;
grant execute on function app.nextcloud_sitzung(uuid, bytea, timestamptz) to crm_auth;
grant execute on function app.nextcloud_verknuepfte(uuid) to crm_auth;
grant execute on function app.nextcloud_dienst_kontext(uuid) to crm_auth;
grant execute on function app.einziger_betrieb() to crm_auth;
