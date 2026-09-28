# Film night

A small phone app for picking a family film: choose who's watching, a mood or a film you liked, and get five picks with IMDb ratings and where each one is streaming in the UK.

## Put it online (GitHub Pages)
1. Create a new repository (for example `film-night`). Choose Add file, then Upload files, and select every file in this folder.
2. The nightly refresh has to live in a folder GitHub insists on. Choose Add file, then Create new file, type `.github/workflows/refresh.yml` as the name (the slashes make the folders), paste in the contents of `refresh.yml`, and commit.
3. Go to Settings, then Pages. Under "Build and deployment", choose "Deploy from a branch", pick `main` and `/ (root)`, and save.
4. After a minute the app is at `https://<your-username>.github.io/film-night/`.
5. On each phone, open that link in Safari (iPhone) or Chrome (Android) and choose "Add to Home Screen".

## Turn on the nightly ratings and streaming refresh
1. Sign up at themoviedb.org, then go to Settings, then API, and request a free developer key (personal use).
2. Copy the long "API Read Access Token".
3. In the GitHub repo: Settings, then Secrets and variables, then Actions, then "New repository secret". Name it `TMDB_TOKEN` and paste the token.
4. Go to the Actions tab, open "Refresh film data" and press "Run workflow". It takes a couple of minutes, then runs by itself every night.

The refresh fills in IMDb ratings, UK streaming platforms, BBFC certificates and runtimes. Until it has run once, the app works without them.
If the log lists films "Not found on TMDB", add their TMDB number to `tmdb-ids.json`.

## Keeping it up to date
- `catalogue.json` is the hand-picked film list and the shared "already seen" list. `build_catalogue.py` rebuilds it. Changing it triggers a refresh.
- `films.json` is what the app reads. The nightly refresh rewrites it, so don't edit it by hand.
- "We've seen it" saves on that phone only. Use "Copy watched list to send to Claude" and paste it into a chat to get it added to the shared list.
- To change which services count as yours, edit `OUR_SERVICES` near the top of `app.js`.

## How picks work
- "+ Watchlist" adds a film to any of Mum, Dad, Kid 1 or Kid 2's watchlists; the Watchlists tab shows them, filtered by person. Films on a viewer's watchlist rise up their picks and come off the list once they've seen it.
- After "We've seen it", each viewer can rate it Great, OK or Meh. After 3 ratings the app learns each person's taste and nudges picks towards it; the Ratings tab shows what it has learned.
- "Look up a film" searches every film in the app by title and shows its plot summary, where it's streaming, and whether you've seen it. "Find similar" turns it into a "Something like…" search.
- Moods can be combined (Funny and Feel good finds films that are both). "Narrow it down" filters by release date and minimum rating.
- "We've seen it" hides a film on this phone for good (with Undo). "Not tonight" hides it on this phone for 12 hours. "Show me 5 others" pages through everything that fits without repeats.
- As well as the hand-picked films in `catalogue.json`, the nightly refresh adds every well-known film currently on your services (up to 2,500, most popular first). Their moods come from TMDB genres and keywords, and their watch-outs aren't hand-checked, so Gentle mode only shows the U and PG ones. Settings are at the top of `refresh.py`.
- Who's watching hides films any of them has seen. With no kids selected, grown-up films rise to the top and kids' films sink.
- Gentle mode comes on whenever Kid 2 is selected and goes off otherwise; you can still flip it by hand.
- Each ticket says whether a film is free (BBC iPlayer, ITVX, Channel 4, My5), included with a subscription (Netflix, Prime Video, Disney+), or only to rent or buy.

## Shared "seen" list (optional)
1. Create a Google Sheet (any name), then Extensions, then Apps Script. Replace the code with `google-apps-script.js` and save.
2. Deploy, then New deployment, type Web app. Execute as: Me. Who has access: Anyone. Authorise when asked, then copy the URL ending `/exec`.
3. Set the family passcode: in Apps Script, Project Settings (cog), then Script properties, then Add script property. Name `PASSCODE`, value your code.
4. Paste the `/exec` URL into `config.js` and commit.
5. On each phone, enter the passcode once at the bottom of the app. Without it, "seen" marks stay on that phone and upload later once the passcode is entered.
Every phone then shares seen films, watchlists and ratings, and the nightly refresh copies the sheet into `films.json` as a backup. The sheet only holds film IDs, Mum/Dad/Kid 1/Kid 2 and dates. Anyone with the link can read the list, but only someone with the passcode can change it. The passcode lives in the script's settings and on each phone, never in the public code.
If you change the script later, use Deploy, then Manage deployments, then edit the existing deployment, so the URL stays the same.

## Credits and privacy
Streaming data from JustWatch via TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB. IMDb ratings from IMDb's non-commercial datasets.

The repository and site are public. Keep names, ages and personal details out of every file: viewers are Mum, Dad, Kid 1 and Kid 2, and Gentle mode is a general setting. The TMDB token stays in GitHub's secret settings and never appears in the code.
