-- E-Mail-Vorlagen an einem Ort (Wunsch Jamil, Talk msg 2789).
--
-- Die Mail-Vorlagen aus dem Nachfassen (Migration 050) werden zur Bibliothek für alle Mails: Jede Vorlage bekommt
-- einen Zweck, einen Schalter „Signatur anhängen“ und kann Standard ihres Zwecks sein (höchstens eine je Zweck).
-- Bestehende Vorlagen bleiben unverändert erhalten; ihr Zweck ergibt sich aus den Nachfass-Stufen, die sie benutzen.
-- Die früher fest eingebauten Texte (Auftragsbestätigung, Terminbestätigung, Portal-Link …) legt die App beim ersten
-- Bedarf als Standard-Vorlagen an (src/lib/mail-vorlagen.ts).
-- Neues Recht `vorlagen.verwalten` für die Bibliothek; Chef- und Büro-Rollen und alle mit „Einstellungen“ bekommen es.

alter table app.mail_vorlagen
	add column zweck text not null default 'allgemein'
		check (zweck in ('allgemein', 'nachfassen_angebot', 'zahlungserinnerung', 'auftragsbestaetigung', 'buchungsbestaetigung', 'portal_link', 'bewertung')),
	add column mit_signatur boolean not null default true,
	add column ist_standard boolean not null default false;

update app.mail_vorlagen v set zweck = 'zahlungserinnerung'
where exists (select 1 from app.nachfass_stufen s where s.mail_vorlage_id = v.id and s.betrieb_id = v.betrieb_id and s.art = 'rechnung');
update app.mail_vorlagen v set zweck = 'nachfassen_angebot'
where zweck = 'allgemein'
	and exists (select 1 from app.nachfass_stufen s where s.mail_vorlage_id = v.id and s.betrieb_id = v.betrieb_id and s.art = 'angebot');

-- je Betrieb und Zweck die älteste Vorlage als Standard
update app.mail_vorlagen v set ist_standard = true
where v.id = (select x.id from app.mail_vorlagen x where x.betrieb_id = v.betrieb_id and x.zweck = v.zweck order by x.angelegt, x.id limit 1)
	and v.zweck <> 'allgemein';

create unique index mail_vorlagen_standard_idx on app.mail_vorlagen (betrieb_id, zweck) where ist_standard;
create index mail_vorlagen_zweck_idx on app.mail_vorlagen (betrieb_id, zweck);

grant insert (zweck, mit_signatur, ist_standard), update (zweck, mit_signatur, ist_standard) on app.mail_vorlagen to crm_app;

-- Terminbestätigung je Dienst wählbar (leer = Standard)
alter table app.buchung_dienste add column mail_vorlage_id uuid,
	add constraint buchung_dienste_mail_vorlage_fk foreign key (mail_vorlage_id, betrieb_id)
		references app.mail_vorlagen (id, betrieb_id) on delete set null (mail_vorlage_id);
grant insert (mail_vorlage_id), update (mail_vorlage_id) on app.buchung_dienste to crm_app;

-- Auftragsbestätigung: Mail mit anderer Vorlage neu aufbauen
grant update (mail_betreff, mail_text) on app.auftragsbestaetigungen to crm_app;

update app.rollen set rechte = array_append(rechte, 'vorlagen.verwalten')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte)) and not ('vorlagen.verwalten' = any (rechte));
