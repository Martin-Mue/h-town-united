-- Completes Sets-Modus's rollout to the anonymous public live view (/live/:slug) — the other
-- deliberately deferred piece from 20260909180500_add_tournament_sets_mode.sql's own comment.
-- The match-level sets SCORE ("2:1") already reaches PublicTournament.tsx today with no schema
-- change at all — it lives in bracket[].score1/score2 (see Game.tsx's saveGame(), which already
-- writes game.setsWon there instead of game.legsWon once a match used Sets-Modus), and `bracket`
-- was already exposed on this view. What's missing is the tournament-level FORMAT info
-- (best_of_sets itself) that PublicTournament.tsx's header lines want for a "FT3 (Sätze) · FT3
-- (Legs)"-style label, mirroring Tournament.tsx's own organizer-side header.
--
-- Appended right after best_of_legs, matching the live view's actual current column order
-- (verified via information_schema before writing this, not assumed from migration file history —
-- see reference_lovable_database_access memory for why that distinction matters in this project) —
-- same convention 20260826140100_expose_manual_release_on_tournaments_public.sql already used.
CREATE OR REPLACE VIEW public.tournaments_public
WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  mode,
  status,
  champion,
  players,
  bracket,
  game_mode,
  best_of_legs,
  best_of_sets,
  round_configs,
  public_slug,
  public_view,
  boards,
  attendance,
  prestart_views,
  manual_release
FROM public.tournaments
WHERE public_view = true;

GRANT SELECT ON public.tournaments_public TO anon, authenticated;
