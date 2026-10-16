-- Zeitlimits für die Rollen der Anwendung (crm_app, crm_admin, crm_auth):
--   * statement_timeout 30s: eine einzelne Abfrage, die hängt oder ausufert, blockiert keine Verbindung des Pools
--     dauerhaft, sondern wird abgebrochen (Fehler → 500 für diese eine Anfrage).
--   * idle_in_transaction_session_timeout 60s: eine offene, aber untätige Transaktion (z. B. abgebrochener Request)
--     hält nicht ewig Sperren; die Verbindung wird beendet und vom Pool ersetzt.
-- Rolleneinstellungen sind clusterweit (für alle Datenbanken, hier `in database` bewusst nicht gesetzt) und gelten
-- für neue Verbindungen. ALTER ROLE … SET ist idempotent: Ein erneuter Lauf (z. B. beim Migrieren von crm_test)
-- setzt dieselben Werte. Der Superuser `crm` (Migrationen, Seed, admin:anlegen) bleibt ohne Limit.

alter role crm_app set statement_timeout = '30s';
alter role crm_app set idle_in_transaction_session_timeout = '60s';
alter role crm_admin set statement_timeout = '30s';
alter role crm_admin set idle_in_transaction_session_timeout = '60s';
alter role crm_auth set statement_timeout = '30s';
alter role crm_auth set idle_in_transaction_session_timeout = '60s';
