-- Wunsch Jamil (msg 2499): In der Rechte-Struktur einstellbar, wessen To-dos eine Rolle sieht. Neues Recht
-- „todos.alle_lesen“ (Alle To-dos sehen): Chef/Büro/Admin sehen standardmäßig alle To-dos, Monteure nur ihre eigenen
-- (direkt zugewiesen oder in ihren Aufträgen) – außer man gibt ihnen das Recht.
--
-- Bestehende Rollen: Wer bisher alle Aufträge sah, sah auch alle To-dos – diese Rollen bekommen das neue Recht, damit
-- sich für sie nichts ändert.

update app.rollen set rechte = array_append(rechte, 'todos.alle_lesen')
where 'auftraege.alle_lesen' = any (rechte) and not ('todos.alle_lesen' = any (rechte));
