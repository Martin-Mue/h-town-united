# Autodarts-Overlay im Dartspot/H-Town-Stil

Reine Darstellungsschicht. `submitDetectedRound`, `AutodartsLiveScore` (Polling, Commit, Review) und der Turn-Tracker bleiben unverändert.

## Verhalten für Nutzer
- Sobald im Spiel eine Autodarts-Quelle aktiv ist (`autodartsEnabled && autodartsSource`), erscheint automatisch das neue Overlay statt des Arena-Layouts. Keine Nutzer-Einstellung.
- Kleiner Umschalter "Klassisch / Overlay" in der Spielleiste; Wahl gilt nur für dieses Spiel (im bestehenden Spiel-Snapshot gespeichert, damit ein Reload sie behält).
- Vollbild-Knopf (Beamer/Tablet): blendet Navigation und Menüs aus, zeigt nur Overlay.

## Aufbau des Overlays
```text
+-----------------------------------------------------------+
| [H-Town Wasserzeichen]   Leg 2/5 · Set 1/3     [⛶] [⇄]    |
+---------------------------+-------------------------------+
| > SPIELER A  (dran)       |   SPIELER B                   |
|      141                  |      220                      |
|  Legs 1 · Sets 0          |  Legs 1 · Sets 0              |
|  Ø Leg 58.3 · Ø Match 61  |  Ø Leg 49.0 · Ø Match 52      |
+---------------------------+-------------------------------+
|   [ T20 ]  [ T19 ]  [  –  ]     Aufnahme: 117             |
|   Checkout: T20 · T19 · D12                               |
+-----------------------------------------------------------+
| Autodarts-Status (kompakt) · Review/Korrektur aufklappbar |
+-----------------------------------------------------------+
```
- Handy hochkant: Spieler gestapelt, aktiver Spieler groß oben, Gegner kompakte Zeile; Dart-Slots und Checkout darunter, alles ohne Scrollen auf einem Bildschirm.
- Tablet/Beamer quer: Spieler nebeneinander, Rest-Zahl sehr groß (skaliert mit Bildschirmhöhe), hoher Kontrast.
- 3–4 Spieler: Raster mit kleineren Karten, aktiver Spieler hervorgehoben.
- Bust: rote Einblendung "BUST" auf der Spielerkarte + kurzes Schütteln. Leg-Sieg: Gold-Einblendung mit Namen und Leg-Stats, nutzt das vorhandene Konfetti und `legWonBanner`.

## Wiederverwendung
- `ArenaScoreCard`-Daten (`arenaCards`) aus `Game.tsx` – Rest, Legs/Sets, Averages, aktiv, Live-Vorschau sind schon berechnet.
- `ArenaDartSlots` + `pendingLiveDarts`/`pendingLiveBust` (kommen bereits per `onPendingChange` von Autodarts).
- `CheckoutSuggestion` / `checkoutRoute` für Rest ≤ 170 inkl. Single/Double-Out pro Spieler.
- `AnimatedScore`, Konfetti, `legWonBanner`, H-Town-Logo-Asset, Design-Tokens aus `index.css`.
- `AutodartsLiveScore` bleibt eingebunden (gleiche Props), nur in einem kompakten Bereich unter dem Overlay; das Review-Fenster unverändert.

## Neu
- `components/game/autodarts/AutodartsOverlay.tsx` – Layout-Hülle, rein über Props.
- `AutodartsOverlayPlayer.tsx` – große Spielerkarte (Varianten: aktiv/kompakt).
- `AutodartsOverlayEffects.tsx` – Bust- und Leg-Sieg-Einblendungen.
- `useFullscreenOverlay.ts` – Fullscreen-API mit Fallback (iPhone: CSS-Vollbild `fixed inset-0`), Wake-Lock gegen Bildschirmsperre.
- Neue Design-Tokens (z. B. `--overlay-bust`, `--overlay-win`, Schriftgrößen per `clamp()`), keine festen Farben.

## Verbindung Zustand → Overlay
`Game.tsx` entscheidet: `const useOverlay = autodartsEnabled && !!autodartsSource && viewMode !== "classic"`. Dann rendert es `<AutodartsOverlay cards={arenaCards} pendingDarts={pendingLiveDarts} busted={pendingLiveBust} checkout={...} legWon={legWonBanner} ...>` und reicht `<AutodartsLiveScore>` als Kind durch. Keine neuen Callbacks in die Spiellogik; nur Lesen vorhandener Werte. Bust-Animation wird aus `pendingLiveBust` (Vorschau) bzw. Wechsel des aktiven Spielers nach Bust-Commit abgeleitet.

## Risiken
- iPhone Safari: keine echte Fullscreen-API für Seiten → CSS-Vollbild, `100dvh` statt `100vh`, `overscroll-behavior: none`, Safe-Area-Abstände; Body-Scroll sperren nur im Vollbild.
- Adressleiste/Tastatur verändert Höhe → Layout mit `dvh` + `clamp()` statt fixer Pixel.
- `Game.tsx` ist sehr groß (3500 Zeilen): Eingriff auf eine Verzweigung beschränken, Rest in neue Dateien.
- Doppelte Darstellung von Live-Darts (AutodartsLiveScore-Karte + Overlay) → Karte im Overlay-Modus kompakt halten.
- Beamer-Lesbarkeit: Kontrast in hellem und dunklem Theme prüfen.
- Bildschirm geht aus → Wake-Lock (nicht überall verfügbar, still ignorieren).

## Schritte (mit grober Credit-Schätzung)
1. Design-Tokens + `AutodartsOverlayPlayer` + `AutodartsOverlay` (statisch, Props) – ca. 2–3 Credits
2. Einbindung in `Game.tsx` mit automatischer Aktivierung + Umschalter Klassisch/Overlay (im Snapshot) – ca. 2 Credits
3. Live-Dart-Slots + Checkout-Vorschlag im Overlay – ca. 1–2 Credits
4. Bust- und Leg-Sieg-Animationen – ca. 1–2 Credits
5. Vollbild/Beamer-Modus inkl. iPhone-Fallback und Wake-Lock – ca. 2 Credits
6. Responsiv-Feinschliff 2–4 Spieler, Handy hochkant/quer, Prüfung per Screenshots – ca. 1–2 Credits

Gesamt grob 9–13 Credits; Schätzung, abhängig von Nacharbeiten.

## Technische Hinweise
- Tests: kleiner Test für die Entscheidungsregel "Overlay aktiv wenn Autodarts-Quelle gewählt und nicht auf klassisch gestellt".
- Vorhandene Autodarts- und Turn-Tracker-Tests müssen unverändert grün bleiben.
