"use strict";
const VIEWERS = ["Mum", "Dad", "Kid 1", "Kid 2"];
const KIDS = ["Kid 1", "Kid 2"];
const MOODS = [
  ["feelgood", "Feel good"], ["funny", "Funny"], ["thrilling", "Thrilling"], ["mystery", "Mystery"],
  ["adventure", "Adventure"], ["animated", "Animated"], ["heartfelt", "Heartfelt"], ["truestory", "True story"],
  ["crime", "Crime"], ["scifi", "Sci-fi"], ["sport", "Sport"], ["musical", "Musical"]
];
const FLAG_TEXT = { loud: "Loud scenes", flashing: "Flashing lights", scary: "Scary moments", violence: "Some violence",
  sad: "Sad moments", language: "Strong language", subtitles: "Subtitles" };
const PER_PAGE = 5;
const THIS_YEAR = new Date().getFullYear();
const ERAS = [["any", "Any time"], ["new", "New releases"], ["2010", "2010 on"], ["2000", "2000 on"], ["old", "Before 2000"]];
const RATINGS = [[0, "Any rating"], [6, "6+"], [7, "7+"], [8, "8+"]];
const SKIP_HOURS = 12;
// Services the household can watch without paying extra
const OUR_SERVICES = ["Netflix", "Prime Video", "Disney+", "BBC iPlayer", "ITVX", "Channel 4", "My5"];

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("fn:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("fn:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};

let DATA = { films: [], seen: [] };
let byId = new Map();
const enriched = () => !!DATA.checked;
const plats = (f) => (f.p || []).map((x) => (Array.isArray(x) ? x : [x, "inc"])).filter(([n]) => OUR_SERVICES.includes(n));
const onOurs = (f) => plats(f).length > 0;
const kidsIn = () => KIDS.some((k) => state.who.has(k));
// On a grown-ups' night, kids' films sink and grown-up films rise
const AUDIENCE_WEIGHT = { kids: -4, family: -0.5, adults: 1.5 };
const state = {
  who: new Set(store.get("who", ["Mum", "Dad"])),
  gentle: false, // set from who's watching on load
  ours: store.get("ours", true),
  moods: new Set(),
  era: store.get("era", "any"),
  minRating: store.get("minRating", 0),
  like: null,
  page: 0,
  seed: Math.floor(Math.random() * 1e9)
};
let localSeen = store.get("seenLocal", {}); // id -> {who:[...], date:"YYYY-MM-DD"}
// Shared "seen" list in the family Google Sheet (see config.js); a cached copy works offline
const SHEET = (window.FILM_NIGHT_SHEET || "").trim();
let sharedSeen = store.get("sharedSeen", []);
let passcode = store.get("code", ""); // entered once per phone, never in the code
// Watchlists and ratings: [{id, who, date}] and [{id, who, v: "great"|"ok"|"meh", date}]
let watch = store.get("watch", []);
let rates = store.get("rates", []);
const today = () => new Date().toISOString().slice(0, 10);
function saveLists() { store.set("watch", watch); store.set("rates", rates); store.set("sharedSeen", sharedSeen); store.set("seenLocal", localSeen); }
function sheetPost(body) {
  if (!SHEET || !passcode) return;
  fetch(SHEET, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...body, code: passcode }) }).catch(() => {});
}
async function checkCode(code) {
  const r = await fetch(SHEET + "?check=" + encodeURIComponent(code), { cache: "no-store" });
  return (await r.json()).ok === true;
}
async function syncShared() {
  if (!SHEET) return;
  try {
    const r = await fetch(SHEET, { cache: "no-store" });
    const data = await r.json();
    sharedSeen = data.seen || [];
    const onSheet = new Set(sharedSeen.map((x) => x.id));
    if (passcode) for (const [id, v] of Object.entries(localSeen)) {
      if (!onSheet.has(id)) { sheetPost({ action: "seen", id, who: v.who, date: v.date }); sharedSeen.push({ id, who: v.who, date: v.date }); }
    }
    // Watchlists and ratings: the sheet is the master copy; anything only on this phone is sent up
    if (Array.isArray(data.watch)) {
      const key = (x) => x.id + "|" + x.who;
      const sw = new Set(data.watch.map(key));
      const extra = passcode ? watch.filter((x) => !sw.has(key(x))) : [];
      extra.forEach((x) => sheetPost({ action: "watch", id: x.id, who: x.who, date: x.date }));
      watch = data.watch.concat(extra);
      const sr = new Set((data.ratings || []).map(key));
      const extraR = passcode ? rates.filter((x) => !sr.has(key(x))) : [];
      extraR.forEach((x) => sheetPost({ action: "rate", id: x.id, who: x.who, v: x.v, date: x.date }));
      rates = (data.ratings || []).concat(extraR);
    }
    saveLists(); renderAll();
  } catch { /* offline or sheet unavailable: keep the cached copy */ }
}
const watchersOf = (id) => watch.filter((x) => x.id === id).map((x) => x.who);
function toggleWatch(id, who) {
  if (watch.some((x) => x.id === id && x.who === who)) {
    watch = watch.filter((x) => !(x.id === id && x.who === who)); sheetPost({ action: "unwatch", id, who });
  } else {
    watch.push({ id, who, date: today() }); sheetPost({ action: "watch", id, who, date: today() });
  }
  saveLists();
}
const rateOf = (id, who) => (rates.find((x) => x.id === id && x.who === who) || {}).v || "";
function setRate(id, who, v) {
  const same = rateOf(id, who) === v;
  rates = rates.filter((x) => !(x.id === id && x.who === who));
  if (!same) rates.push({ id, who, v, date: today() });
  sheetPost({ action: "rate", id, who, v: same ? "" : v, date: today() });
  saveLists();
}
function markSeen(id, who) {
  const mark = { who: [...who], date: today() };
  localSeen[id] = mark;
  sharedSeen = sharedSeen.filter((x) => x.id !== id).concat([{ id, ...mark }]);
  sheetPost({ action: "seen", id, who: mark.who, date: mark.date });
  // Once someone has seen it, it comes off their watchlist
  for (const w of mark.who) if (watch.some((x) => x.id === id && x.who === w)) toggleWatch(id, w);
  saveLists();
}
function unmarkSeen(id) {
  delete localSeen[id]; sharedSeen = sharedSeen.filter((x) => x.id !== id);
  sheetPost({ action: "unseen", id }); saveLists();
}

// Taste: learned from Great / OK / Meh ratings
const RATE_WEIGHT = { great: 2, ok: 0.3, meh: -1.5 };
const RATE_LABEL = { great: "Great", ok: "OK", meh: "Meh" };
const tokens = (f) => f.m.map((m) => "m:" + m).concat(f.g.slice(0, 12).map((t) => "g:" + stem(t)));
let taste = {};
function buildTaste() {
  taste = {};
  for (const r of rates) {
    const f = byId.get(r.id); if (!f) continue;
    const p = taste[r.who] || (taste[r.who] = { n: 0, t: {} });
    p.n++;
    for (const k of tokens(f)) p.t[k] = (p.t[k] || 0) + RATE_WEIGHT[r.v];
  }
}
function tasteFor(f, who) {
  const p = taste[who]; if (!p || p.n < 3) return 0;
  const ks = tokens(f);
  return ks.reduce((a, k) => a + (p.t[k] || 0), 0) / Math.sqrt(ks.length || 1);
}
function tasteSummary(who) {
  const p = taste[who];
  if (!p || p.n < 3) return `Rate ${3 - (p ? p.n : 0)} more ${p && p.n === 2 ? "film" : "films"} to start learning ${who}'s taste.`;
  const moods = Object.entries(p.t).filter(([k]) => k.startsWith("m:")).map(([k, v]) => [(MOODS.find((x) => x[0] === k.slice(2)) || [0, k.slice(2)])[1], v]);
  const likes = moods.filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);
  const not = moods.filter(([, v]) => v < -0.5).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([l]) => l);
  return `${who} (${p.n} rated): ${likes.length ? "enjoys " + likes.join(", ") : "no clear favourites yet"}${not.length ? ". Less keen on " + not.join(", ") : ""}.`;
}
// "Not tonight": hidden on this phone for a few hours
let skipped = Object.fromEntries(Object.entries(store.get("skipped", {})).filter(([, t]) => t > Date.now()));
const rating = (f) => f.ir || f.tr || 0;
function eraOk(y) {
  switch (state.era) {
    case "new": return y >= THIS_YEAR - 1;
    case "2010": return y >= 2010;
    case "2000": return y >= 2000;
    case "old": return y < 2000;
    default: return true;
  }
}

const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function rand(seed, s) { let h = seed ^ 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }

function seenBy(id) {
  const who = new Set();
  DATA.seen.filter((s) => s.id === id).forEach((s) => s.who.forEach((w) => who.add(w)));
  if (localSeen[id]) localSeen[id].who.forEach((w) => who.add(w));
  sharedSeen.filter((s) => s.id === id).forEach((s) => s.who.forEach((w) => who.add(w)));
  return who;
}
function hiddenAsSeen(id) {
  const who = seenBy(id);
  if (who.has("Family")) return true;
  for (const w of state.who) if (who.has(w)) return true;
  return false;
}
function allowed(f) {
  if (state.gentle && f.i >= 3) return false;
  // Auto-added films have no hand-checked watch-outs, so Gentle mode only keeps U and PG ones
  if (state.gentle && f.auto && !["U", "PG"].includes(f.c)) return false;
  if (state.ours && enriched() && !onOurs(f)) return false;
  if ((f.c === "18" || f.c === "?") && kidsIn()) return false;
  if (skipped[f.id]) return false;
  if (!eraOk(f.y)) return false;
  if (state.minRating && rating(f) < state.minRating) return false;
  return !hiddenAsSeen(f.id);
}
const stem = (t) => t.replace(/s$/, "");
function similarity(a, b) {
  const bs = new Set(b.g.map(stem));
  const tags = a.g.filter((t) => bs.has(stem(t)));
  const moods = a.m.filter((m) => b.m.includes(m));
  return { score: tags.length * 2 + moods.length * 1.5, tags };
}

function ranked() {
  const liked = state.like ? byId.get(state.like) : null;
  let list = DATA.films.filter((f) => f.id !== state.like && allowed(f));
  // Every chosen mood must match: Funny + Feel good means both
  if (state.moods.size) list = list.filter((f) => [...state.moods].every((m) => f.m.includes(m)));
  const scored = list.map((f) => {
    let score = 0, why = null;
    if (liked) {
      const s = similarity(liked, f);
      score = s.score;
      if (s.tags.length) why = `Like ${liked.t}: ${s.tags.slice(0, 3).map((t) => t.replace(/-/g, " ")).join(", ")}`;
      else if (score) why = `Same kind of mood as ${liked.t}`;
    }
    const listed = watchersOf(f.id).filter((w) => state.who.has(w));
    const fits = [...state.who].map((w) => [w, tasteFor(f, w)]);
    const t = fits.length ? fits.reduce((a, [, v]) => a + v, 0) / fits.length : 0;
    if (!why && listed.length) why = `On ${possessive(listed)} watchlist`;
    const suits = fits.filter(([, v]) => v > 1.2).map(([w]) => w);
    if (!why && suits.length) why = `Suits ${possessive(suits)} taste`;
    return { f, score, why, key: score + (rating(f) || 6.5) * 0.25 + (f.auto ? 0 : 0.6) + (kidsIn() ? 0 : AUDIENCE_WEIGHT[f.a] || 0)
      + (listed.length ? 2.5 : 0) + Math.max(-3, Math.min(3, t)) * 0.7 + rand(state.seed, f.id) * 1.2 };
  }).filter((x) => !liked || x.score > 0);
  scored.sort((a, b) => b.key - a.key);
  return scored;
}

function possessive(names) {
  const p = names.map((n) => n + "'s");
  return p.length > 1 ? p.slice(0, -1).join(", ") + " and " + p[p.length - 1] : p[0];
}
function moodLine(f) {
  return f.m.map((m) => (MOODS.find((x) => x[0] === m) || [m, m])[1]).join(", ");
}
function warnLine(f) {
  let flags = [...f.f];
  if (state.gentle) flags.sort((a, b) => ["loud", "flashing"].includes(b) - ["loud", "flashing"].includes(a));
  const parts = flags.map((x) => FLAG_TEXT[x]).filter(Boolean);
  if (f.n) parts.push(f.n);
  return parts.join(". ");
}
const imdbUrl = (f) => f.imdb ? `https://www.imdb.com/title/${f.imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(f.t + " " + f.y)}&s=tt&ttype=ft`;
const whereUrl = (f) => `https://www.justwatch.com/uk/search?q=${encodeURIComponent(f.t)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function whereLine(f) {
  if (!enriched()) return "";
  const p = plats(f);
  const free = p.filter(([, k]) => k === "free").map(([n]) => n);
  const inc = p.filter(([, k]) => k !== "free").map(([n]) => n);
  const parts = [];
  if (free.length) parts.push("Free on " + free.join(", "));
  if (inc.length) parts.push("Included with " + inc.join(", "));
  if (parts.length) return parts.join(". ");
  if (f.po && f.po.length) parts.push("Not on your services. On " + f.po.slice(0, 2).join(", "));
  if (f.pr && f.pr.length) parts.push("Rent or buy on " + f.pr.slice(0, 3).join(", "));
  return parts.join(". ") || "Not streaming in the UK right now";
}
function whoText() {
  const w = VIEWERS.filter((v) => state.who.has(v));
  return w.length > 1 ? w.slice(0, -1).join(", ") + " and " + w[w.length - 1] : w[0];
}

// ---------- Views ----------
const VIEWS = [["pick", "Pick"], ["watch", "Watchlists"], ["rated", "Ratings"]];
state.view = store.get("view", "pick");
state.watchWho = store.get("watchWho", "all");
state.ratedWho = store.get("ratedWho", "all");

function renderAll() {
  buildTaste();
  $("nav").innerHTML = VIEWS.map(([k, l]) =>
    `<button type="button" data-view="${k}" aria-pressed="${state.view === k}">${l}</button>`).join("");
  for (const [k] of VIEWS) $("view-" + k).hidden = state.view !== k;
  if (state.view === "pick") { render(); renderLookup(); }
  if (state.view === "watch") renderWatch();
  if (state.view === "rated") renderRated();
  renderFooter();
}

function render() {
  $("who").innerHTML = VIEWERS.map((v) =>
    `<button class="chip" type="button" data-who="${v}" aria-pressed="${state.who.has(v)}">${v}</button>`).join("");
  $("moods").innerHTML = MOODS.map(([k, l]) =>
    `<button class="chip" type="button" data-mood="${k}" aria-pressed="${state.moods.has(k)}">${l}</button>`).join("");
  $("eras").innerHTML = ERAS.map(([k, l]) =>
    `<button class="chip" type="button" data-era="${k}" aria-pressed="${state.era === k}">${l}</button>`).join("");
  $("ratings").innerHTML = RATINGS.map(([k, l]) =>
    `<button class="chip" type="button" data-rating="${k}" aria-pressed="${state.minRating === k}">${l}</button>`).join("");
  $("gentle").checked = state.gentle;
  $("ours").checked = state.ours;
  $("ours-row").hidden = !enriched();
  $("gentle-hint").textContent = state.gentle
    ? "Hides intense films and puts loud or flashing scenes first in the watch-outs. Comes on with Kid 2."
    : "Showing everything, including intense films.";

  const res = $("results");
  const n = Object.keys(skipped).length;
  $("skipped-row").hidden = !n;
  $("skipped-count").textContent = `${n} ${n === 1 ? "film" : "films"} hidden for tonight.`;
  if (!state.who.size) {
    $("summary").textContent = ""; $("shuffle").hidden = $("more").hidden = true;
    res.innerHTML = `<div class="empty">Choose who's watching to see picks.</div>`;
    return;
  }
  const list = ranked();
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const page = state.page % pages;
  const shown = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  $("shuffle").hidden = $("more").hidden = list.length <= PER_PAGE;
  if (!shown.length) {
    $("summary").textContent = "";
    res.innerHTML = `<div class="empty">Nothing fits all of that. Try fewer moods, a wider date or rating, or turn off Gentle mode.</div>`;
    return;
  }
  $("summary").textContent = `${list.length} ${list.length === 1 ? "film fits" : "films fit"} ${whoText()}. Showing ${page * PER_PAGE + 1} to ${page * PER_PAGE + shown.length}.`;
  res.innerHTML = shown.map(({ f, why }) => ticketHTML(f, why, "pick")).join("");
}

function statusLine(f) {
  const who = [...seenBy(f.id)];
  const parts = [];
  if (who.includes("Family")) parts.push("You've all seen this");
  else if (who.length) parts.push("Seen by " + who.join(", "));
  const r = VIEWERS.map((w) => [w, rateOf(f.id, w)]).filter(([, v]) => v).map(([w, v]) => `${w}: ${RATE_LABEL[v]}`);
  if (r.length) parts.push(r.join(", "));
  if (skipped[f.id]) parts.push("Hidden for tonight");
  return parts.join(". ");
}
function aboutHTML(f) {
  if (!f.o) return "";
  const m = f.o.match(/^.*?[.!?](?=\s|$)/);
  const first = m ? m[0] : f.o;
  const rest = f.o.slice(first.length).trim();
  return rest
    ? `<details class="about"><summary>${esc(first)} <span class="more">More</span></summary><p>${esc(rest)}</p></details>`
    : `<p class="about">${esc(first)}</p>`;
}
function ticketHTML(f, why, mode) {
  const warn = warnLine(f);
  const status = mode !== "pick" ? statusLine(f) : "";
  const seen = seenBy(f.id).size > 0;
  const lists = watchersOf(f.id);
  const where = whereLine(f);
  return `<article class="ticket">
      <div class="body">
        <h3>${esc(f.t)}</h3>
        <p class="meta">${f.y}${f.ir ? ` · IMDb ${f.ir.toFixed(1)}` : f.tr ? ` · TMDB ${Number(f.tr).toFixed(1)}` : ""}</p>
        ${where ? `<p class="where">${esc(where)}</p>` : ""}
        ${aboutHTML(f)}
        ${status ? `<p class="status">${esc(status)}</p>` : ""}
        ${lists.length ? `<p class="status">On ${esc(possessive(lists))} watchlist</p>` : ""}
        <p class="why">${esc(why || moodLine(f))}</p>
        ${warn ? `<p class="warn">${esc(warn)}</p>` : ""}
        <div class="actions">
          <a class="btn" href="${imdbUrl(f)}" target="_blank" rel="noopener">IMDb</a>
          <a class="btn" href="${whereUrl(f)}" target="_blank" rel="noopener">Where to watch</a>
          <button class="btn ${lists.length ? "done" : ""}" type="button" data-watch="${f.id}">${lists.length ? "★ Watchlist" : "+ Watchlist"}</button>
          ${seen && mode !== "pick" ? `<button class="btn" type="button" data-rateopen="${f.id}">Rate it</button>`
                                    : `<button class="btn" type="button" data-seen="${f.id}">We've seen it</button>`}
          ${mode === "pick" ? `<button class="btn" type="button" data-skip="${f.id}">Not tonight</button>` : ""}
          ${mode === "lookup" ? `<button class="btn" type="button" data-likethis="${f.id}">Find similar</button>` : ""}
        </div>
      </div>
      <div class="stub" aria-label="Certificate ${f.c}${f.r ? `, ${f.r} minutes` : ""}">
        <span class="cert">${esc(f.c)}</span>${f.r ? `<span class="mins">${f.r} min</span>` : ""}
      </div>
    </article>`;
}

function renderLookup() {
  const q = norm($("lookup").value || "");
  const out = $("lookup-results");
  if (!q) { out.innerHTML = ""; return; }
  const hits = DATA.films.filter((f) => norm(f.t).includes(q))
    .sort((a, b) => (norm(b.t).startsWith(q) - norm(a.t).startsWith(q)) || (rating(b) - rating(a)))
    .slice(0, 5);
  const raw = $("lookup").value.trim();
  if (!hits.length) {
    out.innerHTML = `<div class="empty">
      <p>That film isn't in the app. The app holds every well-known film on your services, so it probably isn't on any of them right now.</p>
      <div class="actions" style="margin-top:10px">
        <a class="btn" href="https://www.justwatch.com/uk/search?q=${encodeURIComponent(raw)}" target="_blank" rel="noopener">Check JustWatch</a>
        <a class="btn" href="https://www.imdb.com/find/?q=${encodeURIComponent(raw)}&s=tt&ttype=ft" target="_blank" rel="noopener">Look it up on IMDb</a>
      </div></div>`;
    return;
  }
  out.innerHTML = `<div class="tickets">${hits.map((f) => ticketHTML(f, null, "lookup")).join("")}</div>`;
}

const personChips = (attr, current) => [["all", "Everyone"], ...VIEWERS.map((v) => [v, v])].map(([k, l]) =>
  `<button class="chip" type="button" data-${attr}="${k}" aria-pressed="${current === k}">${l}</button>`).join("");

function renderWatch() {
  $("watch-who").innerHTML = personChips("wfilter", state.watchWho);
  const ids = [...new Set(watch.filter((x) => state.watchWho === "all" || x.who === state.watchWho)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((x) => x.id))].filter((id) => byId.has(id));
  $("watch-results").innerHTML = ids.length
    ? `<p class="hint" style="margin-bottom:12px">${ids.length} ${ids.length === 1 ? "film" : "films"}${state.watchWho === "all" ? " across everyone's watchlists" : ` on ${state.watchWho}'s watchlist`}.</p>
       <div class="tickets">${ids.map((id) => ticketHTML(byId.get(id), null, "watch")).join("")}</div>`
    : `<div class="empty">${state.watchWho === "all" ? "Nobody's" : state.watchWho + "'s"} watchlist is empty. Tap <strong>+ Watchlist</strong> on any film to add it.</div>`;
}

function seenFilms() {
  const map = new Map();
  const add = (id, who, date) => {
    const e = map.get(id) || { id, who: new Set(), date: "" };
    who.forEach((w) => e.who.add(w)); if (date && date > e.date) e.date = date; map.set(id, e);
  };
  DATA.seen.forEach((s) => add(s.id, s.who, ""));
  sharedSeen.forEach((s) => add(s.id, s.who, s.date));
  Object.entries(localSeen).forEach(([id, s]) => add(id, s.who, s.date));
  rates.forEach((r) => add(r.id, [r.who], r.date));
  return [...map.values()].filter((e) => byId.has(e.id));
}
function renderRated() {
  $("rated-who").innerHTML = personChips("rfilter", state.ratedWho);
  const people = state.ratedWho === "all" ? VIEWERS : [state.ratedWho];
  $("taste").innerHTML = people.map((w) => `<p>${esc(tasteSummary(w))}</p>`).join("");
  const list = seenFilms()
    .filter((e) => state.ratedWho === "all" || e.who.has(state.ratedWho) || e.who.has("Family"))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  $("rated-results").innerHTML = list.length ? list.map((e) => {
    const f = byId.get(e.id);
    const raters = e.who.has("Family") ? VIEWERS : VIEWERS.filter((w) => e.who.has(w));
    const shownRaters = state.ratedWho === "all" ? raters : raters.filter((w) => w === state.ratedWho);
    return `<article class="rated-row">
      <h3>${esc(f.t)} <span class="yr">${f.y}</span></h3>
      <p class="hint">${e.who.has("Family") ? "Seen by everyone" : "Seen by " + [...e.who].join(", ")}${e.date ? ` on ${new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p>
      ${shownRaters.map((w) => `<div class="rate-line"><span>${w}</span>${["great", "ok", "meh"].map((v) =>
        `<button class="chip small" type="button" data-rate="${f.id}|${w}|${v}" aria-pressed="${rateOf(f.id, w) === v}">${RATE_LABEL[v]}</button>`).join("")}</div>`).join("")}
    </article>`;
  }).join("") : `<div class="empty">Nothing marked as seen yet.</div>`;
}

function renderFooter() {
  const ls = Object.keys(localSeen).length;
  $("share-row").hidden = !SHEET || !!passcode;
  $("forget-code").hidden = !SHEET || !passcode;
  $("local-count").textContent = SHEET
    ? (passcode ? "Seen films, watchlists and ratings are shared with everyone's phones."
                : "Enter the family passcode to share seen films, watchlists and ratings with everyone's phones. Until then they're saved on this phone.")
    : (ls ? `${ls} ${ls === 1 ? "film" : "films"} marked as seen on this phone.` : "Seen films, watchlists and ratings are saved on this phone.");
}

// ---------- Pop-up panels ----------
function openPanel(html) {
  const d = $("panel");
  $("panel-body").innerHTML = html;
  if (!d.open) d.showModal();
}
function watchPanel(id) {
  const f = byId.get(id);
  openPanel(`<h2>Add to whose watchlist?</h2><p class="hint">${esc(f.t)} (${f.y})</p>
    <div class="chips" style="margin:14px 0">${VIEWERS.map((w) =>
      `<button class="chip" type="button" data-watchwho="${id}|${w}" aria-pressed="${watchersOf(id).includes(w)}">${w}</button>`).join("")}</div>
    <button class="btn primary" type="button" data-close>Done</button>`);
}
function ratePanel(id, justSeen) {
  const f = byId.get(id);
  const who = [...seenBy(id)];
  const raters = who.includes("Family") ? VIEWERS : VIEWERS.filter((w) => who.includes(w));
  openPanel(`<h2>How was it?</h2><p class="hint">${esc(f.t)} (${f.y}). Ratings help the app learn who likes what.</p>
    <div style="margin:14px 0;display:grid;gap:10px">${raters.map((w) => `<div class="rate-line"><span>${w}</span>${["great", "ok", "meh"].map((v) =>
      `<button class="chip small" type="button" data-rate="${id}|${w}|${v}" aria-pressed="${rateOf(id, w) === v}">${RATE_LABEL[v]}</button>`).join("")}</div>`).join("")}</div>
    <div class="row" style="margin-top:0">
      ${justSeen ? `<button class="btn" type="button" data-unseen="${id}">Oops, not seen it</button>` : "<span></span>"}
      <button class="btn primary" type="button" data-close>Done</button>
    </div>`);
}

function toast(msg, undo) {
  const t = $("toast");
  t.innerHTML = esc(msg) + (undo ? ` <button type="button" id="undo">Undo</button>` : "");
  t.classList.add("show"); t.classList.toggle("actionable", !!undo);
  if (undo) $("undo").onclick = () => { undo(); t.classList.remove("show"); };
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), undo ? 5000 : 2200);
}

function wire() {
  $("who").addEventListener("click", (e) => {
    const b = e.target.closest("[data-who]"); if (!b) return;
    const v = b.dataset.who; state.who.has(v) ? state.who.delete(v) : state.who.add(v);
    if (v === "Kid 2") state.gentle = state.who.has("Kid 2");
    store.set("who", [...state.who]); state.page = 0; render();
  });
  $("moods").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mood]"); if (!b) return;
    const m = b.dataset.mood; state.moods.has(m) ? state.moods.delete(m) : state.moods.add(m); state.page = 0; render();
  });
  $("eras").addEventListener("click", (e) => {
    const b = e.target.closest("[data-era]"); if (!b) return;
    state.era = b.dataset.era; store.set("era", state.era); state.page = 0; render();
  });
  $("ratings").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rating]"); if (!b) return;
    state.minRating = Number(b.dataset.rating); store.set("minRating", state.minRating); state.page = 0; render();
  });
  $("save-code").addEventListener("click", async () => {
    const code = $("code").value.trim(); if (!code) return;
    $("save-code").disabled = true;
    try {
      if (await checkCode(code)) { passcode = code; store.set("code", code); $("code").value = ""; toast("Passcode accepted"); syncShared(); renderAll(); }
      else toast("That passcode isn't right");
    } catch { toast("Couldn't check it. Are you online?"); }
    $("save-code").disabled = false;
  });
  $("forget-code").addEventListener("click", () => { passcode = ""; store.set("code", ""); renderAll(); toast("Passcode removed from this phone"); });
  $("unskip").addEventListener("click", () => { skipped = {}; store.set("skipped", skipped); render(); toast("Showing them again"); });
  $("ours").addEventListener("change", (e) => { state.ours = e.target.checked; store.set("ours", state.ours); state.page = 0; render(); });
  $("gentle").addEventListener("change", (e) => { state.gentle = e.target.checked; state.page = 0; render(); });
  const others = () => {
    const total = ranked().length;
    state.page++;
    if (state.page * PER_PAGE >= total) { state.page = 0; toast("That's everything that fits. Back to the start."); }
    render(); $("summary").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("shuffle").addEventListener("click", others);
  $("more").addEventListener("click", others);
  $("lookup").addEventListener("input", renderLookup);
  $("panel").addEventListener("close", () => renderAll());
  $("panel").addEventListener("click", (e) => { if (e.target === $("panel")) $("panel").close(); });

  // One handler for buttons on tickets, lists and panels
  document.addEventListener("click", (e) => {
    const t = (sel) => e.target.closest(sel);
    let b;
    if ((b = t("[data-view]"))) { state.view = b.dataset.view; store.set("view", state.view); renderAll(); window.scrollTo(0, 0); return; }
    if ((b = t("[data-wfilter]"))) { state.watchWho = b.dataset.wfilter; store.set("watchWho", state.watchWho); renderWatch(); return; }
    if ((b = t("[data-rfilter]"))) { state.ratedWho = b.dataset.rfilter; store.set("ratedWho", state.ratedWho); renderRated(); return; }
    if ((b = t("[data-close]"))) { $("panel").close(); return; }
    if ((b = t("[data-watch]"))) { watchPanel(b.dataset.watch); return; }
    if ((b = t("[data-watchwho]"))) {
      const [id, w] = b.dataset.watchwho.split("|"); toggleWatch(id, w);
      b.setAttribute("aria-pressed", watchersOf(id).includes(w)); return;
    }
    if ((b = t("[data-rate]"))) {
      const [id, w, v] = b.dataset.rate.split("|"); setRate(id, w, v);
      b.parentElement.querySelectorAll("[data-rate]").forEach((x) => x.setAttribute("aria-pressed", rateOf(id, w) === x.dataset.rate.split("|")[2]));
      buildTaste(); if (state.view === "rated" && !$("panel").open) $("taste").innerHTML = (state.ratedWho === "all" ? VIEWERS : [state.ratedWho]).map((x) => `<p>${esc(tasteSummary(x))}</p>`).join("");
      return;
    }
    if ((b = t("[data-rateopen]"))) { ratePanel(b.dataset.rateopen, false); return; }
    if ((b = t("[data-seen]"))) {
      const id = b.dataset.seen;
      if (!state.who.size) { toast("Choose who's watching first"); return; }
      markSeen(id, state.who); ratePanel(id, true); return;
    }
    if ((b = t("[data-unseen]"))) {
      const id = b.dataset.unseen; unmarkSeen(id);
      rates = rates.filter((x) => !(x.id === id && state.who.has(x.who))); saveLists();
      $("panel").close(); toast("Unmarked"); return;
    }
    if ((b = t("[data-skip]"))) {
      const id = b.dataset.skip;
      skipped[id] = Date.now() + SKIP_HOURS * 3600e3; store.set("skipped", skipped); render();
      toast("Hidden for tonight", () => { delete skipped[id]; store.set("skipped", skipped); render(); });
      return;
    }
    if ((b = t("[data-likethis]"))) {
      const f = byId.get(b.dataset.likethis);
      state.like = f.id; state.page = 0; $("like").value = f.t; $("lookup").value = ""; renderLookup(); render();
      $("like-h").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const input = $("like"), sug = $("suggest");
  const pick = (id) => {
    state.like = id; state.page = 0; input.value = byId.get(id).t; sug.hidden = true;
    $("like-hint").textContent = ""; render();
  };
  input.addEventListener("input", () => {
    const q = norm(input.value);
    if (!q) { sug.hidden = true; if (state.like) { state.like = null; render(); } $("like-hint").textContent = ""; return; }
    const hits = DATA.films.filter((f) => norm(f.t).includes(q)).slice(0, 6);
    sug.innerHTML = hits.map((f) => `<li><button type="button" data-pick="${f.id}">${esc(f.t)} (${f.y})</button></li>`).join("");
    sug.hidden = !hits.length;
    $("like-hint").textContent = hits.length ? "" : "That film isn't in the app.";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = sug.querySelector("[data-pick]"); if (first) { e.preventDefault(); pick(first.dataset.pick); input.blur(); }
  });
  sug.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) pick(b.dataset.pick); });

  $("copy").addEventListener("click", async () => {
    const films = seenFilms().filter((e) => e.date);
    if (!films.length) { toast("Nothing marked as seen yet"); return; }
    const text = "Film night: please add these to our watch log.\n" + films.map((e) => {
      const f = byId.get(e.id);
      const r = VIEWERS.map((w) => [w, rateOf(e.id, w)]).filter(([, v]) => v).map(([w, v]) => `${w} ${RATE_LABEL[v]}`);
      return `- ${f.t} (${f.y}): seen by ${[...e.who].join(", ")} on ${e.date}${r.length ? `. Ratings: ${r.join(", ")}` : ""}`;
    }).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into Claude."); }
    catch { window.prompt("Copy this and paste it into Claude:", text); }
  });
}

async function start() {
  wire();
  try {
    const r = await fetch("films.json", { cache: "no-cache" });
    DATA = await r.json();
  } catch {
    $("results").innerHTML = `<div class="empty">Couldn't load the film list. Check your connection and reopen the app.</div>`;
    return;
  }
  byId = new Map(DATA.films.map((f) => [f.id, f]));
  state.gentle = state.who.has("Kid 2");
  for (const s of DATA.seen) if (localSeen[s.id]) delete localSeen[s.id];
  store.set("seenLocal", localSeen);
  const autoN = DATA.films.filter((f) => f.auto).length;
  $("updated").textContent = `${DATA.films.length - autoN} hand-picked films${autoN ? ` and ${autoN} more from your services` : ""}. `;
  $("updated").textContent += `Film list updated ${new Date(DATA.updated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. ${DATA.checked ? `Streaming checked ${new Date(DATA.checked).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.` : ""} Certificates are a guide.`;
  renderAll();
  syncShared();
}
start();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
