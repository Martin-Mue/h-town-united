# Fehlende Migrationen anwenden

## Prüfergebnis

Verglichen wurden alle 88 Migrationsdateien im Repo mit der Live-Datenbank. Die Migrationen bis einschließlich `20260908155636` (league_fixtures.scheduled_date) sind angewendet. Die folgenden **5 jüngsten Migrationen fehlen** in der Datenbank:

| Migration | Datei | Fehlendes Artefakt |
|-----------|-------|--------------------|
| 20260909172031 | `add_sets_mode_columns.sql` | `games.best_of_sets`, `player1_sets_won`, `player2_sets_won` |
| 20260909180500 | `add_tournament_sets_mode.sql` | `tournaments.best_of_sets` |
| 20260909182000 | `add_online_match_sets_mode.sql` | `online_matches.best_of_sets` |
| 20260909183000 | `expose_best_of_sets_on_tournaments_public.sql` | `tournaments_public`-View enthält nicht `best_of_sets` |
| 20260909190000 | `add_league_public_view.sql` | `leagues.public_view`/`public_slug`, `league_fixtures.player1_name`/`player2_name`, Views `leagues_public`/`league_fixtures_public`, anon-Policies |

Alle anderen jüngsten Migrationen sind bestätigt angewendet:
- `match_reflections`-Tabelle ✓ (20260908155517)
- `league_fixtures.scheduled_date` ✓ (20260908155636 / 20260907120000)

## Was zu tun ist

Die 5 fehlenden Migrationen über das Migrations-Tool anwenden. Alle Statements sind bereits mit `IF NOT EXISTS` / `CREATE OR REPLACE` / `IF EXISTS` abgesichert und damit sicher mehrfach ausführbar. Nach dem Apply erfolgt eine Verifikationsabfrage, die bestätigt, dass alle neuen Spalten/Views vorhanden sind. Danach werden die Supabase-Typen neu generiert, damit das Frontend die neuen Felder typsicher nutzen kann.

Kein Frontend-Code muss angefasst werden — die App-Seite ist bereits im Repo und erwartet diese Spalten.
