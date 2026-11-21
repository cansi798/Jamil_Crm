-- Kundenportal-Kopf hell als Standard (Jamil, Talk „CRM System“ msg 6546, 21.11.2026: „Mach den Hintergrund nicht
-- anthrazit, sondern weiß, Header auch.“). Der bisherige Standard Anthrazit (#2d2c2e) wurde vom Farbfeld der Einstellung
-- „Farbe des Kopfs“ immer mitgespeichert – er gilt deshalb als „nicht gewählt“ und wird auf den neuen Standard
-- (leer = weiß) zurückgesetzt. Jede andere, bewusst gewählte Kopffarbe bleibt unverändert.
update app.betrieb_profil set dunkel_farbe = null where lower(dunkel_farbe) = '#2d2c2e';
