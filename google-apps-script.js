/** @OnlyCurrentDoc */
// Film night shared lists: seen films, watchlists and ratings.
// Paste into the Google Sheet's Apps Script editor (Extensions > Apps Script), replacing the old code.
// Passcode: Project Settings (cog) > Script properties > PASSCODE.
// To update the live version without changing its URL: Deploy > Manage deployments > pencil > Version: New version > Deploy.
// The sheet only ever holds film IDs, Mum/Dad/Kid 1/Kid 2, ratings and dates.
const TABS = {
  seen: ["Seen", ["film", "who", "date"]],
  watch: ["Watchlist", ["film", "who", "date"]],
  ratings: ["Ratings", ["film", "who", "rating", "date"]],
};
const WHO = ["Mum", "Dad", "Kid 1", "Kid 2", "Family"];
const RATING_VALUES = ["great", "ok", "meh"];
const MAX_ROWS = 5000;

function tab_(key) {
  const [name, header] = TABS[key];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
const json_ = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const day_ = (v) => (v instanceof Date ? Utilities.formatDate(v, "Europe/London", "yyyy-MM-dd") : String(v || ""));
const today_ = () => Utilities.formatDate(new Date(), "Europe/London", "yyyy-MM-dd");
const rows_ = (key) => tab_(key).getDataRange().getValues().slice(1).filter((r) => r[0]);

function codeOk_(code) {
  const real = PropertiesService.getScriptProperties().getProperty("PASSCODE");
  if (!real) return false;
  if (String(code || "") === real) return true;
  Utilities.sleep(1500);
  return false;
}

function doGet(e) {
  if (e && e.parameter && "check" in e.parameter) return json_({ ok: codeOk_(e.parameter.check) });
  return json_({
    seen: rows_("seen").map((r) => ({ id: String(r[0]), who: String(r[1]).split(",").map((w) => w.trim()).filter(Boolean), date: day_(r[2]) })),
    watch: rows_("watch").map((r) => ({ id: String(r[0]), who: String(r[1]), date: day_(r[2]) })),
    ratings: rows_("ratings").map((r) => ({ id: String(r[0]), who: String(r[1]), v: String(r[2]), date: day_(r[3]) })),
  });
}

// Delete rows for this film (and this person, if given) in one tab
function remove_(key, id, who) {
  const sh = tab_(key), values = sh.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][0]) === id && (!who || String(values[r][1]) === who)) sh.deleteRow(r + 1);
  }
  return sh;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const b = JSON.parse(e.postData.contents || "{}");
    if (!codeOk_(b.code)) return json_({ ok: false, error: "passcode" });
    const id = String(b.id || "");
    if (!/^[a-z0-9-]{3,120}$/.test(id)) return json_({ ok: false, error: "bad id" });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : today_();
    const one = WHO.includes(b.who) ? b.who : null;
    switch (b.action) {
      case "seen": {
        const who = (b.who || []).filter((w) => WHO.includes(w));
        if (!who.length) return json_({ ok: false, error: "bad who" });
        const sh = remove_("seen", id);
        if (sh.getLastRow() < MAX_ROWS) sh.appendRow([id, who.join(", "), date]);
        break;
      }
      case "unseen": remove_("seen", id); break;
      case "watch": {
        if (!one) return json_({ ok: false, error: "bad who" });
        const sh = remove_("watch", id, one);
        if (sh.getLastRow() < MAX_ROWS) sh.appendRow([id, one, date]);
        break;
      }
      case "unwatch": if (one) remove_("watch", id, one); break;
      case "rate": {
        if (!one) return json_({ ok: false, error: "bad who" });
        const sh = remove_("ratings", id, one);
        if (RATING_VALUES.includes(b.v) && sh.getLastRow() < MAX_ROWS) sh.appendRow([id, one, b.v, date]);
        break;
      }
      default: return json_({ ok: false, error: "bad action" });
    }
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
