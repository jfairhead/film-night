"""Refresh films.json from catalogue.json.

For each film it adds:
  imdb  IMDb ID (from TMDB)            ir/iv  IMDb rating and vote count (IMDb datasets)
  p     your-service platforms in the UK   po  other UK subscription platforms
  c, r  BBFC certificate and runtime from TMDB when available
Needs a TMDB key in the environment: TMDB_TOKEN (API Read Access Token) or TMDB_API_KEY.
Streaming data: JustWatch via TMDB. IMDb data: datasets.imdbws.com (personal, non-commercial use).
"""
import csv, datetime, gzip, io, json, os, sys, time, urllib.parse, urllib.request

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
    names = []
    for kind in ("flatrate", "free", "ads"):
        for p in gb.get(kind) or []:
            names.append(p.get("provider_name", ""))
    ours, other = [], []
    for n in names:
        low = n.lower()
        hit = next((label for key, label in SERVICES if key in low), None)
        if hit and hit not in ours: ours.append(hit)
        elif not hit and n and n not in other: other.append(n)
    return ours, other


def gb_cert(rd):
    for c in ((rd or {}).get("results") or []):
        if c.get("iso_3166_1") == "GB":
            certs = [d.get("certification", "").strip() for d in c.get("release_dates") or []]
            certs = [x for x in certs if x in {"U", "PG", "12", "12A", "15", "18"}]
            if certs:
                return certs[0]
    return None


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
        tid = ids.get(f["id"])
        if not tid:
            tid = find_tmdb_id(f)
            if tid: ids[f["id"]] = tid
        if not tid:
            missing.append(f["t"]); films.append(f); continue
        d = get_json(f"/movie/{tid}", language="en-GB", append_to_response="external_ids,watch/providers,release_dates") or {}
        f["tm"] = tid
        imdb = (d.get("external_ids") or {}).get("imdb_id") or d.get("imdb_id")
        if imdb: f["imdb"] = imdb
        f["p"], f["po"] = platforms(d.get("watch/providers"))
        cert = gb_cert(d.get("release_dates"))
        if cert: f["c"] = cert
        if d.get("runtime"): f["r"] = d["runtime"]
        films.append(f)
        time.sleep(0.05)
    ratings = load_ratings({f["imdb"] for f in films if f.get("imdb")})
    for f in films:
        if f.get("imdb") in ratings:
            f["ir"], f["iv"] = ratings[f["imdb"]]
    out = {"updated": cat["updated"], "checked": datetime.date.today().isoformat(), "films": films, "seen": cat["seen"]}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(dict(sorted(ids.items())), open(IDS, "w"), indent=1)
    on = sum(1 for f in films if f.get("p"))
    print(f"{len(films)} films, {on} on your services, {len(ratings)} with IMDb ratings")
    if missing:
        print("Not found on TMDB (add the TMDB id to tmdb-ids.json):", "; ".join(missing))


if __name__ == "__main__":
    main()
