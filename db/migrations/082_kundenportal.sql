-- Kundenportal (Wunsch Jamil, Talk msgs 2770–2774 Punkt 4, Änderungen msg 2778) und Auftragsbestätigung.
--
-- * app.portal_links: Link je Auftrag (oder je Kunde) mit nicht erratbarem Token; gespeichert wird nur der SHA-256.
--   Gilt bis zum Widerruf, optional mit Ablaufdatum. Ohne Anmeldung löst nur app.portal_link_aufloesen (SECURITY
--   DEFINER, nur crm_auth) einen Hash in Link und Betrieb auf – alles Weitere läuft als crm_app im Kontext genau dieses
--   Betriebs (RLS), wie bei der Online-Buchung.
-- * app.portal_auftrag: Was der Chef je Auftrag freigibt (Status, Termine, Vornamen, Online-Annahme); dazu
--   app.portal_dokumente: freigegebene Angebote, Protokolle und Fotos.
-- * app.angebot_entscheidungen: Annahme/Ablehnung im Portal als Nachweis (Zeit, Name, AGB-Häkchen, Hash des Tokens,
--   Hash der IP-Adresse – nie die IP selbst). Keine Unterschrift (msg 2778).
-- * app.auftragsbestaetigungen: Sobald ein Angebot „angenommen“ ist (Portal, Büro oder Sprache), entsteht automatisch
--   eine Auftragsbestätigung (PDF, Nummer AB-JJJJ-NNNN) – abschaltbar je Betrieb und je Auftrag. Versand über die
--   Mail-Schnittstelle; solange die nicht angebunden ist: „bereit zum Versand“ mit To-do und Glocke.
-- * app.portal_ereignisse: Protokoll der Kundenaktionen (Aufruf, PDF angesehen, angenommen, abgelehnt).

create table app.portal_einstellungen (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	id uuid not null unique default gen_random_uuid(),
	agb_url text check (agb_url ~ '^https?://[^\s<>"]+$' and char_length(agb_url) <= 500),
	widerruf_url text check (widerruf_url ~ '^https?://[^\s<>"]+$' and char_length(widerruf_url) <= 500),
	ab_automatisch boolean not null default true,
	geaendert timestamptz not null default now()
);

-- Auftragsbestätigung je Auftrag: leer = wie im Betrieb eingestellt
alter table app.auftraege add column ab_automatisch boolean;
grant update (ab_automatisch) on app.auftraege to crm_app;

create table app.portal_links (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid,
	kunde_id uuid,
	token_hash bytea not null unique check (octet_length(token_hash) = 32),
	laeuft_ab timestamptz,
	widerrufen_am timestamptz,
	angelegt timestamptz not null default now(),
	angelegt_von uuid,
	letzter_zugriff timestamptz,
	zugriffe integer not null default 0,
	unique (id, betrieb_id),
	check ((auftrag_id is null) <> (kunde_id is null)),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete cascade,
	foreign key (angelegt_von, betrieb_id) references app.benutzer (id, betrieb_id)
);
create index portal_links_auftrag_idx on app.portal_links (auftrag_id, betrieb_id);
create index portal_links_kunde_idx on app.portal_links (kunde_id, betrieb_id);

create table app.portal_auftrag (
	auftrag_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	status boolean not null default true,
	termine boolean not null default true,
	mitarbeiter boolean not null default true,
	annahme boolean not null default true,
	geaendert timestamptz not null default now(),
	id uuid not null unique default gen_random_uuid(),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade
);

create table app.portal_dokumente (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	art text not null check (art in ('angebot', 'protokoll', 'datei')),
	ref_id uuid not null,
	angelegt timestamptz not null default now(),
	unique (betrieb_id, auftrag_id, art, ref_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade
);

create table app.angebot_entscheidungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	angebot_id uuid not null,
	link_id uuid,
	entscheidung text not null check (entscheidung in ('angenommen', 'abgelehnt')),
	name text not null check (char_length(btrim(name)) between 1 and 200),
	grund text check (char_length(grund) <= 1000),
	agb_bestaetigt boolean not null default false,
	agb_url text check (char_length(agb_url) <= 500),
	token_hash bytea check (octet_length(token_hash) = 32),
	ip_hash bytea check (octet_length(ip_hash) = 32),
	zeit timestamptz not null default now(),
	unique (id, betrieb_id),
	check (entscheidung = 'abgelehnt' or agb_bestaetigt),
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete cascade,
	foreign key (link_id, betrieb_id) references app.portal_links (id, betrieb_id) on delete set null (link_id)
);
create index angebot_entscheidungen_angebot_idx on app.angebot_entscheidungen (angebot_id, betrieb_id);

create table app.auftragsbestaetigungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	angebot_id uuid not null,
	auftrag_id uuid,
	nummer text not null check (char_length(nummer) <= 40),
	pdf bytea not null check (octet_length(pdf) <= 10485760),
	-- 'bereit' = wartet auf Versand (Mail noch nicht angebunden), 'gesendet' = versendet bzw. von Hand erledigt
	versand_status text not null default 'bereit' check (versand_status in ('bereit', 'gesendet')),
	mail_an text check (char_length(mail_an) <= 200),
	mail_betreff text check (char_length(mail_betreff) <= 300),
	mail_text text check (char_length(mail_text) <= 5000),
	versendet_am timestamptz,
	todo_id uuid,
	ausloeser text not null default 'oberflaeche' check (char_length(ausloeser) <= 40),
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (betrieb_id, angebot_id),
	unique (betrieb_id, nummer),
	check ((versand_status = 'gesendet') = (versendet_am is not null)),
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete cascade,
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete set null (auftrag_id),
	foreign key (todo_id, betrieb_id) references app.todos (id, betrieb_id) on delete set null (todo_id)
);
create index auftragsbestaetigungen_auftrag_idx on app.auftragsbestaetigungen (auftrag_id, betrieb_id);

create table app.portal_ereignisse (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	link_id uuid,
	auftrag_id uuid,
	art text not null check (art in ('aufruf', 'dokument', 'angenommen', 'abgelehnt')),
	text text check (char_length(text) <= 300),
	ip_hash bytea check (octet_length(ip_hash) = 32),
	zeit timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (link_id, betrieb_id) references app.portal_links (id, betrieb_id) on delete set null (link_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade
);
create index portal_ereignisse_auftrag_idx on app.portal_ereignisse (auftrag_id, betrieb_id, zeit desc);

create trigger portal_einstellungen_geaendert before update on app.portal_einstellungen for each row execute function app.setze_geaendert();
create trigger portal_auftrag_geaendert before update on app.portal_auftrag for each row execute function app.setze_geaendert();

revoke all on app.portal_einstellungen, app.portal_links, app.portal_auftrag, app.portal_dokumente, app.angebot_entscheidungen,
	app.auftragsbestaetigungen, app.portal_ereignisse from public, crm_app, crm_admin, crm_auth;

grant select on app.portal_einstellungen to crm_app;
grant insert (betrieb_id, agb_url, widerruf_url, ab_automatisch) on app.portal_einstellungen to crm_app;
grant update (agb_url, widerruf_url, ab_automatisch) on app.portal_einstellungen to crm_app;

grant select on app.portal_links to crm_app;
grant insert (betrieb_id, auftrag_id, kunde_id, token_hash, laeuft_ab, angelegt_von) on app.portal_links to crm_app;
grant update (laeuft_ab, widerrufen_am, letzter_zugriff, zugriffe) on app.portal_links to crm_app;

grant select on app.portal_auftrag to crm_app;
grant insert (auftrag_id, betrieb_id, status, termine, mitarbeiter, annahme) on app.portal_auftrag to crm_app;
grant update (status, termine, mitarbeiter, annahme) on app.portal_auftrag to crm_app;

grant select, delete on app.portal_dokumente to crm_app;
grant insert (betrieb_id, auftrag_id, art, ref_id) on app.portal_dokumente to crm_app;

-- Nachweise: nur anlegen und lesen, nie ändern oder löschen
grant select on app.angebot_entscheidungen to crm_app;
grant insert (betrieb_id, angebot_id, link_id, entscheidung, name, grund, agb_bestaetigt, agb_url, token_hash, ip_hash)
	on app.angebot_entscheidungen to crm_app;

grant select on app.auftragsbestaetigungen to crm_app;
grant insert (betrieb_id, angebot_id, auftrag_id, nummer, pdf, mail_an, mail_betreff, mail_text, todo_id, ausloeser)
	on app.auftragsbestaetigungen to crm_app;
grant update (versand_status, versendet_am, todo_id) on app.auftragsbestaetigungen to crm_app;

grant select on app.portal_ereignisse to crm_app;
grant insert (betrieb_id, link_id, auftrag_id, art, text, ip_hash) on app.portal_ereignisse to crm_app;

alter table app.portal_einstellungen enable row level security;
alter table app.portal_einstellungen force row level security;
alter table app.portal_links enable row level security;
alter table app.portal_links force row level security;
alter table app.portal_auftrag enable row level security;
alter table app.portal_auftrag force row level security;
alter table app.portal_dokumente enable row level security;
alter table app.portal_dokumente force row level security;
alter table app.angebot_entscheidungen enable row level security;
alter table app.angebot_entscheidungen force row level security;
alter table app.auftragsbestaetigungen enable row level security;
alter table app.auftragsbestaetigungen force row level security;
alter table app.portal_ereignisse enable row level security;
alter table app.portal_ereignisse force row level security;

create policy portal_einstellungen_mandant on app.portal_einstellungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy portal_links_mandant on app.portal_links for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy portal_auftrag_mandant on app.portal_auftrag for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy portal_dokumente_mandant on app.portal_dokumente for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy angebot_entscheidungen_mandant on app.angebot_entscheidungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy auftragsbestaetigungen_mandant on app.auftragsbestaetigungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy portal_ereignisse_mandant on app.portal_ereignisse for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Verlauf/Nachweis: Token-Hashes und IP-Hashes und das PDF nie ins Protokoll
create trigger portal_einstellungen_protokoll after insert or update or delete on app.portal_einstellungen
	for each row execute function app.protokolliere('geaendert');
create trigger portal_links_protokoll after insert or update or delete on app.portal_links
	for each row execute function app.protokolliere('token_hash', 'letzter_zugriff', 'zugriffe');
create trigger portal_auftrag_protokoll after insert or update or delete on app.portal_auftrag
	for each row execute function app.protokolliere('geaendert');
create trigger portal_dokumente_protokoll after insert or update or delete on app.portal_dokumente
	for each row execute function app.protokolliere();
create trigger angebot_entscheidungen_protokoll after insert or update or delete on app.angebot_entscheidungen
	for each row execute function app.protokolliere('token_hash', 'ip_hash');
create trigger auftragsbestaetigungen_protokoll after insert or update or delete on app.auftragsbestaetigungen
	for each row execute function app.protokolliere('pdf', 'mail_text');

-- Ohne Anmeldung: Hash des Portal-Tokens → Link, Betrieb, Auftrag/Kunde. Nur gültige Links (nicht widerrufen, nicht
-- abgelaufen) von Betrieben mit aktivem Abo und Modul „kundenportal“. Nur für crm_auth (systemAbfrage).
create function app.portal_link_aufloesen(p_hash bytea)
returns table (link_id uuid, betrieb_id uuid, auftrag_id uuid, kunde_id uuid)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select l.id, l.betrieb_id, l.auftrag_id, l.kunde_id
	from app.portal_links l
	join app.betriebe b on b.id = l.betrieb_id
	join app.tarife t on t.id = b.tarif_id
	where octet_length(p_hash) = 32 and l.token_hash = p_hash and l.widerrufen_am is null
		and (l.laeuft_ab is null or l.laeuft_ab > now())
		and b.abo_status in ('test', 'aktiv') and t.module @> array['kundenportal', 'auftraege']::text[]
$$;
revoke all on function app.portal_link_aufloesen(bytea) from public, crm_app, crm_admin;
grant execute on function app.portal_link_aufloesen(bytea) to crm_auth;
