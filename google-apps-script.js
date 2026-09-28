/** @OnlyCurrentDoc */
// Film night shared "seen" list. Paste into the Google Sheet's Apps Script editor (Extensions > Apps Script),
// then Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone. Copy the /exec URL into config.js.
// The sheet only ever holds film IDs, Mum/Dad/Kid 1/Kid 2 and dates.
// Passcode: Project Settings (cog) > Script properties > Add property, name PASSCODE, value your family code.
// Anyone can read the list; only someone with the passcode can change it. It never appears in the app's code.
const TAB = "Seen";
const WHO = ["Mum", "Dad", "Kid 1", "Kid 2", "Family"];
const MAX_ROWS = 5000;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.appendRow(["film", "who", "date"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function codeOk_(code) {
  const real = PropertiesService.getScriptProperties().getProperty("PASSCODE");
  if (!real) return false; // no passcode set: refuse all changes
  if (String(code || "") === real) return true;
  Utilities.sleep(1500); // slows down anyone trying to guess
  return false;
}

function doGet(e) {
  // ?check=CODE lets the app confirm a passcode before saving it on a phone
  if (e && e.parameter && "check" in e.parameter) return json_({ ok: codeOk_(e.parameter.check) });
  const rows = sheet_().getDataRange().getValues().slice(1);
  return json_({
    seen: rows.filter((r) => r[0]).map((r) => ({
      id: String(r[0]),
      who: String(r[1]).split(",").map((w) => w.trim()).filter(Boolean),
      date: r[2] instanceof Date ? Utilities.formatDate(r[2], "Europe/London", "yyyy-MM-dd") : String(r[2]),
    })),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!codeOk_(body.code)) return json_({ ok: false, error: "passcode" });
    const id = String(body.id || "");
    if (!/^[a-z0-9-]{3,120}$/.test(id)) return json_({ ok: false, error: "bad id" });
    const sh = sheet_();
    // Remove any existing rows for this film, then add the new one if marking as seen
    const values = sh.getDataRange().getValues();
    for (let r = values.length - 1; r >= 1; r--) if (String(values[r][0]) === id) sh.deleteRow(r + 1);
    if (body.action === "seen") {
      if (sh.getLastRow() > MAX_ROWS) return json_({ ok: false, error: "full" });
      const who = (body.who || []).filter((w) => WHO.includes(w));
      if (!who.length) return json_({ ok: false, error: "bad who" });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : Utilities.formatDate(new Date(), "Europe/London", "yyyy-MM-dd");
      sh.appendRow([id, who.join(", "), date]);
    }
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
