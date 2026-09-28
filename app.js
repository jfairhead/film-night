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
function sheetPost(action, id, who, date) {
  if (!SHEET || !passcode) return;
  fetch(SHEET, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, id, who, date, code: passcode }) }).catch(() => {});
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
    store.set("sharedSeen", sharedSeen);
    // Send up anything marked on this phone that the sheet doesn't have yet
    const onSheet = new Set(sharedSeen.map((x) => x.id));
    if (passcode) for (const [id, v] of Object.entries(localSeen)) {
      if (!onSheet.has(id)) { sheetPost("seen", id, v.who, v.date); sharedSeen.push({ id, who: v.who, date: v.date }); }
    }
    render(); renderLookup();
  } catch { /* offline or sheet unavailable: keep the cached copy */ }
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
    return { f, score, why, key: score + (rating(f) || 6.5) * 0.25 + (f.auto ? 0 : 0.6) + (kidsIn() ? 0 : AUDIENCE_WEIGHT[f.a] || 0) + rand(state.seed, f.id) * 1.2 };
  }).filter((x) => !liked || x.score > 0);
  scored.sort((a, b) => b.key - a.key);
  return scored;
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

function render() {
  // who chips
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
  if (!state.who.size) {
    $("summary").textContent = "";
    res.innerHTML = `<div class="empty">Choose who's watching to see picks.</div>`;
    return;
  }
  const list = ranked();
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const page = state.page % pages;
  const shown = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const more = list.length > PER_PAGE;
  $("shuffle").hidden = !more; $("more").hidden = !more;
  const n = Object.keys(skipped).length;
  $("skipped-row").hidden = !n;
  $("skipped-count").textContent = `${n} ${n === 1 ? "film" : "films"} hidden for tonight.`;
  if (!shown.length) {
    $("summary").textContent = "";
    res.innerHTML = `<div class="empty">Nothing fits all of that. Try fewer moods, a wider date or rating, or turn off Gentle mode.</div>`;
    return;
  }
  $("summary").textContent = `${list.length} ${list.length === 1 ? "film fits" : "films fit"} ${whoText()}. Showing ${page * PER_PAGE + 1} to ${page * PER_PAGE + shown.length}.`;
  res.innerHTML = shown.map(({ f, why }) => ticketHTML(f, why)).join("");
  const ls = Object.keys(localSeen).length;
  $("share-row").hidden = !SHEET || !!passcode;
  $("forget-code").hidden = !SHEET || !passcode;
  $("local-count").textContent = SHEET
    ? (passcode ? "Films marked as seen are shared with everyone's phones."
                : "Enter the family passcode to share films marked as seen with everyone's phones. Until then they're saved on this phone.")
    : (ls ? `${ls} ${ls === 1 ? "film" : "films"} marked as seen on this phone. They stay hidden until you clear them.` : "Films you mark as seen are saved on this phone and stay hidden.");
}

function statusLine(f) {
  const who = [...seenBy(f.id)];
  if (who.includes("Family")) return "You've all seen this";
  if (who.length) return "Seen by " + who.join(", ");
  if (skipped[f.id]) return "Hidden for tonight";
  return "";
}
function ticketHTML(f, why, lookup) {
  const warn = warnLine(f);
  const status = lookup ? statusLine(f) : "";
  const seen = seenBy(f.id).size > 0;
  return `<article class="ticket">
      <div class="body">
        <h3>${esc(f.t)}</h3>
        <p class="meta">${f.y}${f.ir ? `, IMDb ${f.ir.toFixed(1)}` : f.tr ? `, TMDB ${Number(f.tr).toFixed(1)}` : ""}</p>
        ${whereLine(f) ? `<p class="where">${esc(whereLine(f))}</p>` : ""}
        ${status ? `<p class="status">${esc(status)}</p>` : ""}
        <p class="why">${esc(why || moodLine(f))}</p>
        ${warn ? `<p class="warn">${esc(warn)}</p>` : ""}
        ${f.o ? (lookup ? `<p class="about">${esc(f.o)}</p>` : `<details class="about"><summary>What's it about?</summary><p>${esc(f.o)}</p></details>`) : ""}
        <div class="actions">
          <a class="btn" href="${imdbUrl(f)}" target="_blank" rel="noopener">IMDb</a>
          <a class="btn" href="${whereUrl(f)}" target="_blank" rel="noopener">Where to watch</a>
          ${seen && lookup ? "" : `<button class="btn" type="button" data-seen="${f.id}">We've seen it</button>`}
          ${lookup ? `<button class="btn" type="button" data-likethis="${f.id}">Find similar</button>`
                   : `<button class="btn" type="button" data-skip="${f.id}">Not tonight</button>`}
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
  out.innerHTML = `<div class="tickets">${hits.map((f) => ticketHTML(f, null, true)).join("")}</div>`;
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
      if (await checkCode(code)) { passcode = code; store.set("code", code); $("code").value = ""; toast("Passcode accepted"); syncShared(); render(); }
      else toast("That passcode isn't right");
    } catch { toast("Couldn't check it. Are you online?"); }
    $("save-code").disabled = false;
  });
  $("forget-code").addEventListener("click", () => { passcode = ""; store.set("code", ""); render(); toast("Passcode removed from this phone"); });
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
  const ticketClick = (e) => {
    const seen = e.target.closest("[data-seen]"), skip = e.target.closest("[data-skip]"), like = e.target.closest("[data-likethis]");
    if (like) {
      const f = byId.get(like.dataset.likethis);
      state.like = f.id; state.page = 0; $("like").value = f.t; $("lookup").value = ""; renderLookup(); render();
      $("like-h").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (seen) {
      const id = seen.dataset.seen;
      const mark = { who: [...state.who], date: new Date().toISOString().slice(0, 10) };
      localSeen[id] = mark;
      sharedSeen = sharedSeen.filter((x) => x.id !== id).concat([{ id, ...mark }]);
      store.set("seenLocal", localSeen); store.set("sharedSeen", sharedSeen);
      sheetPost("seen", id, mark.who, mark.date); render();
      toast(`Marked as seen by ${whoText()}`, () => {
        delete localSeen[id]; sharedSeen = sharedSeen.filter((x) => x.id !== id);
        store.set("seenLocal", localSeen); store.set("sharedSeen", sharedSeen);
        sheetPost("unseen", id); render(); renderLookup();
      });
    } else if (skip) {
      const id = skip.dataset.skip;
      skipped[id] = Date.now() + SKIP_HOURS * 3600e3;
      store.set("skipped", skipped); render();
      toast("Hidden for tonight", () => { delete skipped[id]; store.set("skipped", skipped); render(); });
    }
    renderLookup();
  };
  $("results").addEventListener("click", ticketClick);
  $("lookup-results").addEventListener("click", ticketClick);
  $("lookup").addEventListener("input", renderLookup);

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
    $("like-hint").textContent = hits.length ? "" : "That film isn't in the list yet. Ask Claude to add it.";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = sug.querySelector("[data-pick]"); if (first) { e.preventDefault(); pick(first.dataset.pick); input.blur(); }
  });
  sug.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) pick(b.dataset.pick); });

  $("copy").addEventListener("click", async () => {
    const ids = Object.keys(localSeen);
    if (!ids.length) { toast("Nothing marked as seen yet"); return; }
    const text = "Film night: please add these to our watch log.\n" + ids.map((id) => {
      const f = byId.get(id), s = localSeen[id];
      return `- ${f ? `${f.t} (${f.y})` : id}: seen by ${s.who.join(", ")} on ${s.date}`;
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
  // Drop local marks that the shared list now covers
  for (const s of DATA.seen) if (localSeen[s.id]) delete localSeen[s.id];
  store.set("seenLocal", localSeen);
  const autoN = DATA.films.filter((f) => f.auto).length;
  $("updated").textContent = `${DATA.films.length - autoN} hand-picked films${autoN ? ` and ${autoN} more from your services` : ""}. `;
  $("updated").textContent += `Film list updated ${new Date(DATA.updated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. ${DATA.checked ? `Streaming checked ${new Date(DATA.checked).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.` : ""} Certificates are a guide.`;
  render();
  syncShared();
}
start();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
