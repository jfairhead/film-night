"use strict";
const VIEWERS = ["Mum", "Dad", "Kid 1", "Kid 2"];
const KIDS = ["Kid 1", "Kid 2"];
const MOODS = [
  ["feelgood", "Feel good"], ["funny", "Funny"], ["thrilling", "Thrilling"], ["mystery", "Mystery"],
  ["adventure", "Adventure"], ["animated", "Animated"], ["heartfelt", "Heartfelt"], ["truestory", "True story"],
  ["scifi", "Sci-fi"], ["sport", "Sport"], ["musical", "Musical"]
];
const FLAG_TEXT = { loud: "Loud scenes", flashing: "Flashing lights", scary: "Scary moments", violence: "Some violence",
  sad: "Sad moments", language: "Strong language", subtitles: "Subtitles" };
const PER_PAGE = 5;
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
const onOurs = (f) => (f.p || []).some((x) => OUR_SERVICES.includes(x));
const state = {
  who: new Set(store.get("who", ["Mum", "Dad"])),
  gentle: store.get("gentle", true),
  ours: store.get("ours", true),
  mood: null,
  like: null,
  page: 0,
  seed: Math.floor(Math.random() * 1e9)
};
let localSeen = store.get("seenLocal", {}); // id -> {who:[...], date:"YYYY-MM-DD"}

const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function rand(seed, s) { let h = seed ^ 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }

function seenBy(id) {
  const who = new Set();
  DATA.seen.filter((s) => s.id === id).forEach((s) => s.who.forEach((w) => who.add(w)));
  if (localSeen[id]) localSeen[id].who.forEach((w) => who.add(w));
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
  if (state.ours && enriched() && !onOurs(f)) return false;
  if (f.c === "18" && KIDS.some((k) => state.who.has(k))) return false;
  return !hiddenAsSeen(f.id);
}
function similarity(a, b) {
  const tags = a.g.filter((t) => b.g.includes(t));
  const moods = a.m.filter((m) => b.m.includes(m));
  return { score: tags.length * 2 + moods.length * 1.5, tags };
}

function ranked() {
  const liked = state.like ? byId.get(state.like) : null;
  let list = DATA.films.filter((f) => f.id !== state.like && allowed(f));
  if (state.mood) list = list.filter((f) => f.m.includes(state.mood));
  const scored = list.map((f) => {
    let score = 0, why = null;
    if (liked) {
      const s = similarity(liked, f);
      score = s.score;
      if (s.tags.length) why = `Like ${liked.t}: ${s.tags.slice(0, 3).map((t) => t.replace(/-/g, " ")).join(", ")}`;
      else if (score) why = `Same kind of mood as ${liked.t}`;
    }
    return { f, score, why, key: score + (f.ir || 6.5) * 0.25 + rand(state.seed, f.id) * 1.2 };
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
  const ours = (f.p || []).filter((x) => OUR_SERVICES.includes(x));
  if (ours.length) return "On " + ours.join(", ");
  if (f.po && f.po.length) return "Not on your services. On " + f.po.slice(0, 2).join(", ");
  return "Not streaming on a subscription in the UK";
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
    `<button class="chip" type="button" data-mood="${k}" aria-pressed="${state.mood === k}">${l}</button>`).join("");
  $("gentle").checked = state.gentle;
  $("ours").checked = state.ours;
  $("ours-row").hidden = !enriched();
  $("gentle-hint").textContent = state.gentle
    ? "Hides intense films and puts loud or flashing scenes first in the watch-outs."
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
  $("shuffle").hidden = list.length <= PER_PAGE && !(!state.mood && !state.like);
  if (!shown.length) {
    $("summary").textContent = "";
    res.innerHTML = `<div class="empty">Nothing left that fits. Try another mood, turn off Gentle mode, or ask Claude to add more films.</div>`;
    return;
  }
  $("summary").textContent = `${shown.length} ${shown.length === 1 ? "pick" : "picks"} for ${whoText()}`;
  res.innerHTML = shown.map(({ f, why }) => {
    const warn = warnLine(f);
    const mine = localSeen[f.id];
    return `<article class="ticket">
      <div class="body">
        <h3>${esc(f.t)}</h3>
        <p class="meta">${f.y}${f.ir ? `, IMDb ${f.ir.toFixed(1)}` : ""}</p>
        ${whereLine(f) ? `<p class="where">${esc(whereLine(f))}</p>` : ""}
        <p class="why">${esc(why || moodLine(f))}</p>
        ${warn ? `<p class="warn">${esc(warn)}</p>` : ""}
        <div class="actions">
          <a class="btn" href="${imdbUrl(f)}" target="_blank" rel="noopener">IMDb</a>
          <a class="btn" href="${whereUrl(f)}" target="_blank" rel="noopener">Where to watch</a>
          <button class="btn ${mine ? "done" : ""}" type="button" data-seen="${f.id}" aria-pressed="${!!mine}">${mine ? "Seen (undo)" : "We've seen it"}</button>
        </div>
      </div>
      <div class="stub" aria-label="Certificate ${f.c}, ${f.r} minutes">
        <span class="cert">${esc(f.c)}</span><span class="mins">${f.r} min</span>
      </div>
    </article>`;
  }).join("");
  const n = Object.keys(localSeen).length;
  $("local-count").textContent = n ? `${n} ${n === 1 ? "film" : "films"} marked as seen on this phone.` : "Films you mark as seen are saved on this phone.";
}

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2200);
}

function wire() {
  $("who").addEventListener("click", (e) => {
    const b = e.target.closest("[data-who]"); if (!b) return;
    const v = b.dataset.who; state.who.has(v) ? state.who.delete(v) : state.who.add(v);
    store.set("who", [...state.who]); state.page = 0; render();
  });
  $("moods").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mood]"); if (!b) return;
    state.mood = state.mood === b.dataset.mood ? null : b.dataset.mood; state.page = 0; render();
  });
  $("ours").addEventListener("change", (e) => { state.ours = e.target.checked; store.set("ours", state.ours); state.page = 0; render(); });
  $("gentle").addEventListener("change", (e) => { state.gentle = e.target.checked; store.set("gentle", state.gentle); state.page = 0; render(); });
  $("shuffle").addEventListener("click", () => {
    if (!state.mood && !state.like) state.seed = Math.floor(Math.random() * 1e9); else state.page++;
    render(); $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seen]"); if (!b) return;
    const id = b.dataset.seen;
    if (localSeen[id]) { delete localSeen[id]; b.classList.remove("done"); b.textContent = "We've seen it"; b.setAttribute("aria-pressed", "false"); toast("Removed from seen"); }
    else {
      localSeen[id] = { who: [...state.who], date: new Date().toISOString().slice(0, 10) };
      b.classList.add("done"); b.textContent = "Seen (undo)"; b.setAttribute("aria-pressed", "true");
      toast(`Marked as seen by ${whoText()}`);
    }
    store.set("seenLocal", localSeen);
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
  // Drop local marks that the shared list now covers
  for (const s of DATA.seen) if (localSeen[s.id]) delete localSeen[s.id];
  store.set("seenLocal", localSeen);
  $("updated").textContent = `Film list updated ${new Date(DATA.updated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. ${DATA.checked ? `Streaming checked ${new Date(DATA.checked).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.` : ""} Certificates are a guide.`;
  render();
}
start();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
