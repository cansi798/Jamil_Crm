-- Logo oben links in der App und Akzentfarbe aus dem Logo.
-- Logo oben links in der App (Wunsch Jamil, Talk msg 3014): Die Seitenleiste ist dunkel (Anthrazit), das Briefkopf-Logo
-- ist meist dunkel auf hell. Deshalb eine zweite, optionale Variante „für dunklen Hintergrund“ (helles Logo).
-- Gleiche Regeln wie das Briefkopf-Logo: nur PNG/JPEG, höchstens 1 MB; die Bytes kommen nie ins Änderungsprotokoll.

alter table app.betrieb_profil
	add column if not exists logo_dunkel bytea,
	add column if not exists logo_dunkel_typ text check (logo_dunkel_typ in ('image/png', 'image/jpeg')),
	add column if not exists logo_dunkel_geaendert timestamptz,
	add constraint profil_logo_dunkel check ((logo_dunkel is null) = (logo_dunkel_typ is null) and octet_length(logo_dunkel) <= 1048576);

-- Akzentfarbe aus dem Logo (Wunsch Jamil, Talk msg 3016): beim Hochladen erkannte Farbe (logo_farbe). Solange die
-- Hausfarbe nicht von Hand gewählt wurde (farbe_eigen = false), folgt `farbe` automatisch dieser Logo-Farbe – damit
-- gilt sie überall, wo die Hausfarbe schon wirkt (App, Kundenportal, Online-Buchung). Bestehende Hausfarben gelten
-- als von Hand gewählt und bleiben unverändert.
alter table app.betrieb_profil
	add column if not exists logo_farbe text check (logo_farbe ~ '^#[0-9a-f]{6}$'),
	add column if not exists farbe_eigen boolean not null default false;
update app.betrieb_profil set farbe_eigen = true where farbe is not null;

grant insert (logo_dunkel, logo_dunkel_typ, logo_dunkel_geaendert, logo_farbe, farbe_eigen) on app.betrieb_profil to crm_app;
grant update (logo_dunkel, logo_dunkel_typ, logo_dunkel_geaendert, logo_farbe, farbe_eigen) on app.betrieb_profil to crm_app;

drop trigger betrieb_profil_protokoll on app.betrieb_profil;
create trigger betrieb_profil_protokoll
	after insert or update or delete on app.betrieb_profil
	for each row execute function app.protokolliere('geaendert', 'logo', 'logo_dunkel');
