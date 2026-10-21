-- Erscheinungsbild je Betrieb (Wunsch Jamil, Talk msg 2953): Das Kundenportal soll aussehen wie die Website des
-- Betriebs. Die CRM-App selbst behält ihr Handwerks-Design mit der Hausfarbe; diese Werte gelten im Kundenportal.
--   dunkel_farbe       dunkle Flächen (Kopf), z. B. Anthrazit #2d2c2e
--   hintergrund_farbe  Seitenhintergrund, z. B. warmes Creme #f4f1eb
--   titel_schrift      'montserrat' | 'inter'
--   text_schrift       'inter' | 'opensans'
--   titel_gross        Überschriften in Großbuchstaben (wie die Bauwelt-Website)
-- Leer = Standard (Anthrazit, helles Off-White, Montserrat/Inter, normale Schreibweise).

alter table app.betrieb_profil
	add column if not exists dunkel_farbe text check (dunkel_farbe ~ '^#[0-9a-f]{6}$'),
	add column if not exists hintergrund_farbe text check (hintergrund_farbe ~ '^#[0-9a-f]{6}$'),
	add column if not exists titel_schrift text check (titel_schrift in ('montserrat', 'inter')),
	add column if not exists text_schrift text check (text_schrift in ('inter', 'opensans')),
	add column if not exists titel_gross boolean not null default false;
grant insert (dunkel_farbe, hintergrund_farbe, titel_schrift, text_schrift, titel_gross) on app.betrieb_profil to crm_app;
grant update (dunkel_farbe, hintergrund_farbe, titel_schrift, text_schrift, titel_gross) on app.betrieb_profil to crm_app;
