"""Refresh films.json from catalogue.json.

For each film it adds:
  imdb  IMDb ID (from TMDB)            ir/iv  IMDb rating and vote count (IMDb datasets)
  p     your services in the UK as [name, "free" | "inc"]
  po    other UK subscription services      pr  where it can be rented or bought
  c, r  BBFC certificate and runtime from TMDB when available      o  short plot summary
It also adds every well-known film currently on your services ("auto" films), with moods and tags
worked out from TMDB genres and keywords. Their watch-outs are not hand-checked.
Needs a TMDB key in the environment: TMDB_TOKEN (API Read Access Token) or TMDB_API_KEY.
Streaming data: JustWatch via TMDB. IMDb data: datasets.imdbws.com (personal, non-commercial use).
"""
import csv, datetime, gzip, io, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
CAT = os.path.join(ROOT, "catalogue.json")
IDS = os.path.join(ROOT, "tmdb-ids.json")
OUT = os.path.join(ROOT, "films.json")
RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
TOKEN, KEY = os.environ.get("TMDB_TOKEN"), os.environ.get("TMDB_API_KEY")

# TMDB provider names -> the names the app uses
SERVICES = [("netflix", "Netflix"), ("amazon prime video", "Prime Video"), ("disney", "Disney+"),
            ("iplayer", "BBC iPlayer"), ("itvx", "ITVX"), ("channel 4", "Channel 4"), ("all 4", "Channel 4"),
            ("my5", "My5"), ("channel 5", "My5")]
FREE_SERVICES = {"BBC iPlayer", "ITVX", "Channel 4", "My5"}
STORES = [("apple", "Apple TV"), ("amazon", "Prime Video"), ("google", "Google Play"), ("sky store", "Sky Store"),
          ("rakuten", "Rakuten TV"), ("youtube", "YouTube")]
# Auto films: well-known films on your services, most-voted first
AUTO_MIN_VOTES = 300          # TMDB votes; keeps out obscure titles
AUTO_MAX = 2500               # cap so the app stays quick on a phone
AUTO_PAGES_PER_SERVICE = 60   # 20 films a page
GENRE_MOODS = {"Action": "thrilling", "Adventure": "adventure", "Animation": "animated", "Comedy": "funny",
               "Crime": "crime", "Documentary": "truestory", "Drama": "heartfelt", "Family": "feelgood",
               "Fantasy": "adventure", "History": "truestory", "Horror": "thrilling", "Music": "musical",
               "Mystery": "mystery", "Romance": "heartfelt", "Science Fiction": "scifi", "Thriller": "thrilling",
               "War": "thrilling", "Western": "adventure"}
# Films the TMDB search can't find on its own
OVERRIDES = {"kiki-s-delivery-service-1989": 16859, "kon-tiki-2012": 70667}


def get_json(path, **params):
    if KEY and not TOKEN:
        params["api_key"] = KEY
    url = "https://api.themoviedb.org/3" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"accept": "application/json",
                                               **({"Authorization": "Bearer " + TOKEN} if TOKEN else {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** attempt); continue
            if e.code == 404:
                return None
            raise
        except urllib.error.URLError:
            time.sleep(2 ** attempt)
    raise RuntimeError("TMDB unreachable: " + path)


def find_tmdb_id(f):
    for params in ({"year": f["y"]}, {}):
        res = get_json("/search/movie", query=f["t"], language="en-GB", region="GB", **params) or {}
        results = res.get("results") or []
        if not results:
            continue
        def year(r):
            try: return int((r.get("release_date") or "0")[:4])
            except ValueError: return 0
        results.sort(key=lambda r: (abs(year(r) - f["y"]) > 1, -(r.get("popularity") or 0)))
        best = results[0]
        if abs(year(best) - f["y"]) <= 1:
            return best["id"]
    return None


def platforms(wp):
    gb = ((wp or {}).get("results") or {}).get("GB") or {}
    ours, other, stores = {}, [], []
    for kind in ("flatrate", "ads", "free"):
        for p in gb.get(kind) or []:
            n = p.get("provider_name", "")
            hit = next((label for key, label in SERVICES if key in n.lower()), None)
            if hit:
                free = hit in FREE_SERVICES or kind == "free"
                ours[hit] = "free" if free or ours.get(hit) == "free" else "inc"
            elif n and n not in other:
                other.append(n)
    for kind in ("rent", "buy"):
        for p in gb.get(kind) or []:
            n = p.get("provider_name", "").lower()
            label = next((l for key, l in STORES if key in n), None)
            if label and label not in stores:
                stores.append(label)
    order = sorted(ours.items(), key=lambda kv: kv[1] != "free")
    return [[k, v] for k, v in order], other, stores


def short(text, limit=260):
    """Trim a plot summary to a phone-friendly length, ending on a full sentence where possible."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0] + "…"


def slug(t, y):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-") + f"-{y}"


def service_ids():
    res = get_json("/watch/providers/movie", watch_region="GB", language="en-GB") or {}
    out = {}
    for p in res.get("results") or []:
        low = (p.get("provider_name") or "").lower()
        label = next((l for key, l in SERVICES if key in low), None)
        if label:
            out.setdefault(label, []).append(str(p["provider_id"]))
    return out


def discover_auto(skip_tmdb):
    """tmdb id -> {"r": search result, "labels": set of services}"""
    found = {}
    for label, pids in service_ids().items():
        for page in range(1, AUTO_PAGES_PER_SERVICE + 1):
            res = get_json("/discover/movie", watch_region="GB", with_watch_providers="|".join(pids),
                           with_watch_monetization_types="flatrate|free|ads", sort_by="vote_count.desc",
                           include_adult="false", language="en-GB", page=page,
                           **{"vote_count.gte": AUTO_MIN_VOTES}) or {}
            for r in res.get("results") or []:
                if r["id"] in skip_tmdb or not (r.get("release_date") or "")[:4].isdigit():
                    continue
                found.setdefault(r["id"], {"r": r, "labels": set()})["labels"].add(label)
            if page >= (res.get("total_pages") or 0):
                break
            time.sleep(0.05)
        print(f"  {label}: {sum(1 for v in found.values() if label in v['labels'])} films", flush=True)
    ranked = sorted(found.items(), key=lambda kv: -(kv[1]["r"].get("vote_count") or 0))
    return dict(ranked[:AUTO_MAX])


def auto_film(tid, info, cache):
    r = info["r"]
    p = [[l, "free" if l in FREE_SERVICES else "inc"] for l in sorted(info["labels"], key=lambda l: l not in FREE_SERVICES)]
    base = cache.get(tid)
    if not base:
        d = get_json(f"/movie/{tid}", language="en-GB", append_to_response="external_ids,release_dates,keywords") or {}
        time.sleep(0.05)
        genres = [g["name"] for g in d.get("genres") or []]
        kws = [k["name"] for k in ((d.get("keywords") or {}).get("keywords") or [])]
        moods = []
        for g in genres:
            m = GENRE_MOODS.get(g)
            if m and m not in moods: moods.append(m)
        low = " ".join(kws).lower()
        if "sport" in low and "sport" not in moods: moods.append("sport")
        if "based on true story" in low and "truestory" not in moods: moods.append("truestory")
        cert = gb_cert(d.get("release_dates")) or "?"
        horror = "Horror" in genres
        intensity = 3 if (cert == "18" or horror) else (2 if cert in ("12", "12A", "15", "?") else 1)
        flags = (["scary"] if horror else []) + (["subtitles"] if d.get("original_language") not in (None, "en") else [])
        adult = cert in ("15", "18")
        kids = cert in ("U", "PG") and "animated" in moods
        y = int(r["release_date"][:4])
        title = d.get("title") or r.get("title")
        base = {"id": slug(title, y), "t": title, "y": y, "c": cert, "r": d.get("runtime") or 0,
                "m": moods, "g": [re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-") for x in kws[:12] + genres],
                "i": intensity, "f": flags, "n": "Watch-outs not checked",
                "a": "adults" if adult else ("kids" if kids else "family"), "auto": 1, "tm": tid}
        imdb = (d.get("external_ids") or {}).get("imdb_id")
        if imdb: base["imdb"] = imdb
    f = dict(base)
    f.update({"p": p, "po": [], "pr": [], "tr": r.get("vote_average"), "o": short(r.get("overview"))})
    return f


def gb_cert(rd):
    for c in ((rd or {}).get("results") or []):
        if c.get("iso_3166_1") == "GB":
            certs = [d.get("certification", "").strip() for d in c.get("release_dates") or []]
            certs = [x for x in certs if x in {"U", "PG", "12", "12A", "15", "18"}]
            if certs:
                return certs[0]
    return None


def sheet_seen():
    """Copy the family Google Sheet's "seen" list (URL in config.js) into films.json as a backup."""
    try:
        m = re.search(r'FILM_NIGHT_SHEET\s*=\s*"([^"]+)"', open(os.path.join(ROOT, "config.js")).read())
        if not m:
            return []
        with urllib.request.urlopen(m.group(1), timeout=60) as r:
            rows = json.load(r).get("seen") or []
        return [{"id": x["id"], "who": x["who"]} for x in rows if x.get("id") and x.get("who")]
    except Exception as e:  # the refresh should never fail because of the sheet
        print("Couldn't read the shared seen sheet:", e)
        return []


def load_ratings(wanted):
    print("Downloading IMDb ratings...", flush=True)
    with urllib.request.urlopen(RATINGS_URL, timeout=120) as r:
        data = gzip.decompress(r.read()).decode("utf-8")
    out = {}
    for row in csv.reader(io.StringIO(data), delimiter="\t"):
        if row and row[0] in wanted:
            out[row[0]] = (float(row[1]), int(row[2]))
    return out


def main():
    if not (TOKEN or KEY):
        sys.exit("Set TMDB_TOKEN or TMDB_API_KEY")
    cat = json.load(open(CAT))
    ids = json.load(open(IDS)) if os.path.exists(IDS) else {}
    missing, films = [], []
    for f in cat["films"]:
        f = dict(f)
        tid = ids.get(f["id"]) or OVERRIDES.get(f["id"])
        if not tid:
            tid = find_tmdb_id(f)
            if tid: ids[f["id"]] = tid
        if not tid:
            missing.append(f["t"]); films.append(f); continue
        d = get_json(f"/movie/{tid}", language="en-GB", append_to_response="external_ids,watch/providers,release_dates") or {}
        f["tm"] = tid
        imdb = (d.get("external_ids") or {}).get("imdb_id") or d.get("imdb_id")
        if imdb: f["imdb"] = imdb
        f["p"], f["po"], f["pr"] = platforms(d.get("watch/providers"))
        ty = (d.get("release_date") or "0")[:4]
        if ty.isdigit() and abs(int(ty) - f["y"]) > 1:
            print(f"Check TMDB id for {f['t']} ({f['y']}): it points to {d.get('title')} ({ty})")
        cert = gb_cert(d.get("release_dates"))
        if cert: f["c"] = cert
        if d.get("runtime"): f["r"] = d["runtime"]
        if d.get("overview"): f["o"] = short(d["overview"])
        films.append(f)
        time.sleep(0.05)
    # Auto films, reusing details from the last run so only new arrivals cost API calls
    cache = {}
    if os.path.exists(OUT):
        try:
            for f in json.load(open(OUT)).get("films", []):
                if f.get("auto") and f.get("tm"):
                    cache[f["tm"]] = {k: v for k, v in f.items() if k not in ("p", "po", "pr", "tr", "ir", "iv", "o")}
        except ValueError:
            pass
    print("Finding films on your services...", flush=True)
    known = {f.get("tm") for f in films if f.get("tm")}
    used = {f["id"] for f in films}
    auto = []
    for tid, info in discover_auto(known).items():
        f = auto_film(tid, info, cache)
        if f["id"] in used:
            continue
        used.add(f["id"]); auto.append(f)
    films += auto
    ratings = load_ratings({f["imdb"] for f in films if f.get("imdb")})
    for f in films:
        if f.get("imdb") in ratings:
            f["ir"], f["iv"] = ratings[f["imdb"]]
    seen = list(cat["seen"])
    have = {(s["id"], tuple(s["who"])) for s in seen}
    for s in sheet_seen():
        if (s["id"], tuple(s["who"])) not in have:
            seen.append(s)
    out = {"updated": cat["updated"], "checked": datetime.date.today().isoformat(), "films": films, "seen": seen}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(dict(sorted(ids.items())), open(IDS, "w"), indent=1)
    on = sum(1 for f in films if f.get("p"))
    print(f"{len(films)} films ({len(films) - len(auto)} hand-picked, {len(auto)} added from your services), "
          f"{on} on your services, {len(ratings)} with IMDb ratings")
    if missing:
        print("Not found on TMDB (add the TMDB id to tmdb-ids.json):", "; ".join(missing))


if __name__ == "__main__":
    main()
