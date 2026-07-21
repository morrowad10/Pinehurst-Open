# Golf Trip Leaderboard

A lightweight site for tracking a golf trip's overall leaderboard — team standings across
mixed formats (fourball, foursomes, singles, scramble, skins) and an individual
leaderboard (gross, net, Stableford) across every round. No backend, no build step —
just static HTML/CSS/JS that runs great on GitHub Pages.

## How it's organized

- **Two fixed teams** — each of your 12 players belongs to one of two teams for the
  whole trip. Every round — match play or not — resolves to a single winner (or a
  halve), and points scale with team size: the winning team earns **5 points for
  every one of its members** (edit this in Admin → Scoring Points), and a halved
  round splits half that per member to each side.
  - For match-play rounds (fourball, foursomes, singles), **you never pick a
    winner**. Admin assigns which 4 players are in each foursome; from there, the
    match result is calculated automatically from best-ball on every hole (each
    side's score on a hole is the lower of its 2 players' strokes that hole), and
    the round's winner is decided by majority of the foursomes.
  - For scramble/skins rounds, you set the round's winner directly in Admin (there's
    no natural "majority" for those formats).
- **Four rounds**, each with its own format. Each match-play round page shows one
  live scorecard per foursome — enter all 4 players' strokes and the match result,
  Nassau, and team points calculate themselves.
- **Overall tab** is one master leaderboard, ranked by Total (shown right after the
  player name): Team Event points, Nassau points, and Closest to the Pin points.
  Gross/net/Stableford strokes live on each round's
  own page instead, since they're a different kind of number than the points columns.

## Getting it on GitHub

1. Create a new repository on GitHub (public, so Pages works on the free tier).
2. Push these files to it:
   ```bash
   cd golf-trip-leaderboard
   git init
   git add .
   git commit -m "Initial golf trip leaderboard"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. In the repo on GitHub: **Settings → Pages → Source → Deploy from a branch**, pick
   `main` and `/ (root)`. Save. Your site will be live in a minute or two at
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

## How to enter scores during the trip

The site is static, so there's no shared live database — one person (usually whoever
has laptop/repo access, the "captain") periodically publishes an update; everyone else
just visits the link to view or enter their own scores in the meantime.

1. **Set up before the trip**: in **Admin**, fill in players, teams, points, and each
   round's course/date/format. For match-play rounds, assign the 3 foursomes (which
   4 players play together) — no winner to pick, just who's in each group.
2. **During a match-play round**: open that round's tab. Each foursome has its own
   scorecard — enter all 4 players' 18 holes (front 9 / back 9 / total add up live).
   The match status ("Team One leading 5–3 through 10 holes") updates once you save,
   calculated straight from best-ball on each hole. No login needed, anyone can do
   this on their phone.
3. **During a scramble/skins round**: there's no foursome breakdown — one player
   enters a personal scorecard if they want their stroke play tracked, and in Admin
   someone sets the round's winner directly (team score/skins aren't auto-derived
   for these formats).
4. **Contests**: still entered in Admin — log any contest winners (closest to the
   pin).
5. Everything above autosaves to the browser you're using as you go.
6. When you're ready to publish, click **Export data.json** in the Admin tab. It
   downloads the current state as `data.json`.
7. Replace `data/data.json` in the repo with that file (easiest: on github.com, open
   `data/data.json`, click the pencil/edit icon, paste the new contents, commit
   directly to `main`) and the live site updates for everyone within a minute or two.
8. If you're entering scores from a different device/browser than before, use
   **Import JSON** in Admin first to load the latest `data.json` so you're not
   overwriting anyone else's edits.

## Editing the roster before the trip

Go to Admin → Players to rename the 12 placeholder players, set handicaps, and assign
each to a team. Do this once at the start and export/commit so everyone loads the real
roster.

## Customizing formats and points

Round formats are set per round in Admin (`fourball`, `foursomes`, `singles`,
`scramble`, `skins`, `stableford_team`). The points-per-member formula (default 5,
or half that on a halve) is editable in **Admin → Scoring Points**.

- **Fourball / foursomes**: each foursome's 2v2 result is decided by best-ball on
  every hole (each side's score on a hole is the lower of its 2 players' strokes).
- **Singles**: same 3 foursomes, but Admin shows a dedicated form for it \u2014 pick
  **Pairing 1** (one player from each team) and **Pairing 2** (the other player from
  each team) explicitly, rather than the multi-select used for fourball/foursomes.
  Each pairing is a real 1-on-1 duel; whichever side wins more of the 2 duels wins
  the foursome. Nassau still compares all 4 players in the foursome together, same
  as fourball/foursomes.
- **Scramble / skins**: no foursome breakdown — you pick the round's winner
  directly in Admin.

## Nassau (within each foursome)

Nassau points are computed automatically from the same hole-by-hole scorecards used
for match play, not entered by hand. For any foursome (a match with exactly 4
players), the site compares those 4 players' Front 9, Back 9, and total Gross scores
and awards **1 point per category** to whoever shot lowest — 3 points up for grabs
per foursome, per round. A tie for lowest in a category splits that point evenly
among the tied players, and a category only resolves once at least 2 of the 4
players in that foursome have entered their scorecard.
- Nassau points get their own **Nassau** column on the Overall leaderboard.
- Like the contests, Nassau is purely personal and never affects team standings.

## Closest to the Pin

Right at the top of each round's page there's a simple **Closest to the Pin**
dropdown — pick the winner and it saves immediately, no separate save button needed.
- Worth 2 points by default (awarded automatically when you pick a winner).
- Shows up in its own column on the Overall leaderboard.
- Never affects team standings — it's purely a personal bragging-rights tally.

## Local preview

No install needed — just open `index.html` in a browser, or run a quick local server:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000`.
