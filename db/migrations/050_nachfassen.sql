-- Automatisches Nachfassen (Wünsche Jamil, msgs 2585, 2633, 2636) – ohne Mail-Anbindung (Jamil 2589):
-- Frei einstellbare Stufen je Art (Angebot, Rechnung): „nach N Tagen“ → To-do anlegen und/oder Mail vorbereiten.
-- Eine fällige Stufe legt einen Lauf an (genau einmal je Dokument und Stufe), dazu ein To-do mit Titel aus Vorlage
-- und den fertigen Mailtext (Kopieren / Mailprogramm). Stoppt bei Annahme/Ablehnung, Pause am Angebot oder
-- „kein Nachfassen“ beim Kunden. Rechnungen gibt es im CRM noch nicht – ihre Stufen lassen sich schon einstellen.

-- Wann wurde ein Angebot versendet? (Bisher nur im Änderungsprotokoll.)
alter table app.angebote
	add column versendet_am timestamptz,
	add column nachfassen_pausiert boolean not null default false;
grant update (nachfassen_pausiert) on app.angebote to crm_app;

update app.angebote an set versendet_am = coalesce(
	(select max(ae.zeit) from app.aenderungen ae
		where ae.tabelle = 'angebote' and ae.datensatz_id = an.id and ae.nachher ->> 'status' = 'versendet'
			and ae.vorher ->> 'status' is distinct from 'versendet'),
	an.geaendert)
where an.status in ('versendet', 'angenommen', 'abgelehnt');

create function app.angebot_versendet_am() returns trigger
language plpgsql as $$
begin
	if new.status = 'versendet' and old.status is distinct from 'versendet' then
		new.versendet_am := now();
	end if;
	return new;
end
$$;
create trigger angebote_versendet_am before update of status on app.angebote
	for each row execute function app.angebot_versendet_am();

alter table app.kunden add column kein_nachfassen boolean not null default false;
grant update (kein_nachfassen) on app.kunden to crm_app;

alter table app.betrieb_profil add column signatur_html text check (char_length(signatur_html) <= 20000);
grant insert (signatur_html) on app.betrieb_profil to crm_app;
grant update (signatur_html) on app.betrieb_profil to crm_app;

create table app.mail_vorlagen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 200),
	betreff text not null check (char_length(btrim(betreff)) between 1 and 300),
	html text not null check (char_length(html) <= 50000),
	-- optional: eigene Klartext-Fassung (sonst aus dem HTML erzeugt)
	text text check (char_length(text) <= 50000),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id)
);
create index mail_vorlagen_betrieb_idx on app.mail_vorlagen (betrieb_id, name);

create table app.nachfass_stufen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	art text not null check (art in ('angebot', 'rechnung')),
	pos smallint not null default 0,
	-- Tage nach dem Versand (Angebot) bzw. nach der Fälligkeit (Rechnung)
	tage smallint not null check (tage between 0 and 365),
	todo boolean not null default true,
	mail boolean not null default false,
	todo_titel text check (char_length(todo_titel) <= 300),
	mail_vorlage_id uuid,
	-- Wer bekommt das To-do: fester Mitarbeiter, Zuständiger des Auftrags, erster aktiver Benutzer einer Rolle
	zuweisung text not null default 'zustaendig' check (zuweisung in ('fest', 'zustaendig', 'rolle')),
	benutzer_id uuid,
	rolle_id uuid,
	-- To-do fällig so viele Tage nach dem Anlegen
	faellig_versatz smallint not null default 0 check (faellig_versatz between 0 and 60),
	-- Mahnstufe (nur Rechnung): 0 = Zahlungserinnerung, 1–3
	mahnstufe smallint check (mahnstufe between 0 and 3),
	aktiv boolean not null default true,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (mail_vorlage_id, betrieb_id) references app.mail_vorlagen (id, betrieb_id) on delete set null (mail_vorlage_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (benutzer_id),
	foreign key (rolle_id, betrieb_id) references app.rollen (id, betrieb_id) on delete set null (rolle_id),
	constraint nachfass_stufe_aktion check (todo or mail),
	constraint nachfass_stufe_mail check (not mail or mail_vorlage_id is not null)
);
create index nachfass_stufen_betrieb_idx on app.nachfass_stufen (betrieb_id, art, pos);

create table app.nachfass_laeufe (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	angebot_id uuid not null,
	stufe_id uuid not null,
	stufe_nr smallint not null,
	tage smallint not null,
	todo_id uuid,
	mail_betreff text,
	mail_html text,
	mail_text text,
	mail_an text,
	-- Versand gibt es noch nicht (Anbindung offen); „gesendet“ setzt später die Anbindung oder der Nutzer von Hand
	gesendet_am timestamptz,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (angebot_id, stufe_id),
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete cascade,
	foreign key (stufe_id, betrieb_id) references app.nachfass_stufen (id, betrieb_id) on delete cascade
);
create index nachfass_laeufe_angebot_idx on app.nachfass_laeufe (angebot_id, betrieb_id, angelegt);

alter table app.todos add column nachfass_id uuid;
alter table app.todos add constraint todos_nachfass_fk foreign key (nachfass_id, betrieb_id)
	references app.nachfass_laeufe (id, betrieb_id) on delete set null (nachfass_id);
grant insert (nachfass_id) on app.todos to crm_app;
alter table app.nachfass_laeufe add constraint nachfass_laeufe_todo_fk foreign key (todo_id, betrieb_id)
	references app.todos (id, betrieb_id) on delete set null (todo_id);

create trigger mail_vorlagen_geaendert before update on app.mail_vorlagen for each row execute function app.setze_geaendert();
create trigger nachfass_stufen_geaendert before update on app.nachfass_stufen for each row execute function app.setze_geaendert();

revoke all on app.mail_vorlagen, app.nachfass_stufen, app.nachfass_laeufe from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.mail_vorlagen, app.nachfass_stufen to crm_app;
grant select on app.nachfass_laeufe to crm_app;
grant insert (betrieb_id, name, betreff, html, text) on app.mail_vorlagen to crm_app;
grant update (name, betreff, html, text) on app.mail_vorlagen to crm_app;
grant insert (betrieb_id, art, pos, tage, todo, mail, todo_titel, mail_vorlage_id, zuweisung, benutzer_id, rolle_id,
	faellig_versatz, mahnstufe, aktiv) on app.nachfass_stufen to crm_app;
grant update (pos, tage, todo, mail, todo_titel, mail_vorlage_id, zuweisung, benutzer_id, rolle_id, faellig_versatz,
	mahnstufe, aktiv) on app.nachfass_stufen to crm_app;
grant insert (betrieb_id, angebot_id, stufe_id, stufe_nr, tage, todo_id, mail_betreff, mail_html, mail_text, mail_an)
	on app.nachfass_laeufe to crm_app;
grant update (todo_id, gesendet_am) on app.nachfass_laeufe to crm_app;

alter table app.mail_vorlagen enable row level security;
alter table app.mail_vorlagen force row level security;
alter table app.nachfass_stufen enable row level security;
alter table app.nachfass_stufen force row level security;
alter table app.nachfass_laeufe enable row level security;
alter table app.nachfass_laeufe force row level security;
create policy mail_vorlagen_mandant on app.mail_vorlagen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy nachfass_stufen_mandant on app.nachfass_stufen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy nachfass_laeufe_mandant on app.nachfass_laeufe for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Verlauf: jede Nachfass-Aktion steht im Änderungsprotokoll (Mailtexte ohne HTML, das steht im Lauf selbst)
create trigger mail_vorlagen_protokoll after insert or update or delete on app.mail_vorlagen
	for each row execute function app.protokolliere('geaendert');
create trigger nachfass_stufen_protokoll after insert or update or delete on app.nachfass_stufen
	for each row execute function app.protokolliere('geaendert');
create trigger nachfass_laeufe_protokoll after insert or update or delete on app.nachfass_laeufe
	for each row execute function app.protokolliere('mail_html');
