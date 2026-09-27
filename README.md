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

## Credits and privacy
Streaming data from JustWatch via TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB. IMDb ratings from IMDb's non-commercial datasets.

The repository and site are public. Keep names, ages and personal details out of every file: viewers are Mum, Dad, Kid 1 and Kid 2, and Gentle mode is a general setting. The TMDB token stays in GitHub's secret settings and never appears in the code.
