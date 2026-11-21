-- Kundenportal: Zugangscode je Link für „Angebot annehmen“ (Prüfbericht 21.11.2026, Can 23:21).
--
-- Die PLZ (Standard-Passwort des Portals) ist leicht zu erraten. Zum verbindlichen ANNEHMEN eines Angebots braucht der
-- Kunde deshalb zusätzlich einen zufälligen Zugangscode, der zu genau diesem Link gehört:
-- * erzeugt beim Anlegen des Links bzw. mit „Neuen Zugangscode erzeugen“ (CRM → Kunde → Kundenportal), sicher
--   zufällig (crypto), gezeigt NUR in diesem Moment (Dialog + Portal-Mail);
-- * gespeichert nur als Argon2id-Hash (zugangscode_hash) – das CRM kann ihn danach selbst nicht mehr anzeigen;
-- * Versuchsbegrenzung in der Datenbank (gilt für alle Server-Prozesse): 5 Fehlversuche → 15 Minuten gesperrt.
-- Übergang: Links von vor diesem Update haben keinen Code. Ansehen, Dokumente und Ablehnen gehen weiter wie bisher;
-- „Annehmen“ zeigt dem Kunden „bitte Zugangscode anfordern“, und im CRM steht beim Link „Zugangscode erzeugen“.
-- Ablehnen braucht keinen Code.

alter table app.portal_links
	add column zugangscode_hash text check (zugangscode_hash is null or char_length(zugangscode_hash) between 20 and 300),
	add column zugangscode_erzeugt timestamptz,
	add column code_fehlversuche integer not null default 0 check (code_fehlversuche >= 0),
	add column code_gesperrt_bis timestamptz;

grant insert (zugangscode_hash, zugangscode_erzeugt) on app.portal_links to crm_app;
grant update (zugangscode_hash, zugangscode_erzeugt, code_fehlversuche, code_gesperrt_bis) on app.portal_links to crm_app;

-- Hash und Zähler nicht ins Änderungsprotokoll (nur „Zugangscode erzeugt“ über zugangscode_erzeugt)
drop trigger portal_links_protokoll on app.portal_links;
create trigger portal_links_protokoll after insert or update or delete on app.portal_links
	for each row execute function app.protokolliere('token_hash', 'token_geheim', 'letzter_zugriff', 'zugriffe', 'zugangscode_hash', 'code_fehlversuche', 'code_gesperrt_bis');

alter table app.portal_ereignisse drop constraint portal_ereignisse_art_check;
alter table app.portal_ereignisse add constraint portal_ereignisse_art_check
	check (art in ('aufruf', 'dokument', 'angenommen', 'abgelehnt', 'anmeldung', 'anmeldung_fehler', 'code_fehler'));

-- Gespeicherte Mail-Vorlagen „Kundenportal-Link“ bekommen den Zugangscode (neue Vorlagen haben ihn schon)
update app.mail_vorlagen
set html = case
		when html like '%<p>Bitte geben Sie den Link nicht weiter.</p>%' then replace(html, '<p>Bitte geben Sie den Link nicht weiter.</p>',
			'<p>Ihr Zugangscode zum Annehmen von Angeboten: <strong>{{portal.zugangscode}}</strong></p><p>Bitte geben Sie Link und Code nicht weiter.</p>')
		else html || '<p>Ihr Zugangscode zum Annehmen von Angeboten: <strong>{{portal.zugangscode}}</strong></p>'
	end,
	text = case when text is null or text like '%portal.zugangscode%' then text else text || E'\n\nIhr Zugangscode zum Annehmen von Angeboten: {{portal.zugangscode}}' end
where zweck = 'portal_link' and html not like '%portal.zugangscode%';
