import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(express.json());

// CORS
const allow = process.env.ALLOW_ORIGIN;
app.use(cors(allow ? { origin: allow } : {}));

const SHEET_ID = process.env.SHEET_ID;
const KEYFILE = process.env.GOOGLE_SA_KEYFILE || "./service-account.json";
const PORT = process.env.PORT || 8787;
const PLAYER_SHEET_ID = process.env.PLAYER_SHEET_ID || SHEET_ID;
const PLAYER_SHEET_TAB = process.env.PLAYER_SHEET_TAB || "玩家資料";
const PLAYER_SHEET_RANGE = `${PLAYER_SHEET_TAB}!A:E`;
const PLAYER_MISSION_COLUMNS = {
  mission1: 5
};

if (!SHEET_ID) {
  console.error("Missing SHEET_ID in .env");
  process.exit(1);
}
if (!fs.existsSync(KEYFILE)) {
  console.warn("[Warn] KEYFILE not found yet:", KEYFILE);
}

async function getSheets() {
  const credentialsRaw = fs.readFileSync(KEYFILE, "utf-8");
  const credentials = JSON.parse(credentialsRaw);
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    credentials
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ============== READ CACHE (SWR) ==============
let cache = { rows: null, at: 0, headers: null };
const TTL = 10_000; // 10s

async function refreshCache() {
  const sheets = await getSheets();
  const range = "資料庫!A:Z"; // 讀至 Z 欄，避免常擴表需要改程式
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range
  });
  const values = resp.data.values || [];
  const headers = values[0] || [];
  const rows = values.length > 1 ? values.slice(1) : [];
  cache = { rows, headers, at: Date.now() };
}

function rowToObj(headers, row) {
  const o = {};
  headers.forEach((h, i) => { o[h || `COL${i+1}`] = row[i] ?? ""; });
  return o;
}

function pickByTarget(target) {
  // 假設第一欄是 target 代碼 (01文..12織)
  const t = String(target || "").trim();
  if (!cache.rows) return null;
  const idx = cache.rows.findIndex(r => (r[0] || "").trim() === t);
  if (idx < 0) return null;
  return rowToObj(cache.headers, cache.rows[idx]);
}

app.get("/api/task", async (req, res) => {
  const target = (req.query.target || "").toString();
  const now = Date.now();

  const tryHit = () => pickByTarget(target);

  let hit = tryHit();
  if (hit && now - cache.at < TTL) return res.json(hit);

  // 背景刷新
  refreshCache().catch(() => {});

  // 若有舊資料先回；否則小等一拍
  if (hit) return res.json(hit);
  setTimeout(() => {
    hit = tryHit();
    if (hit) return res.json(hit);
    res.status(404).json({ error: "NOT_FOUND" });
  }, 150);
});

// ============== WRITE QUEUE (BATCH APPEND) ==============
const writeQueue = [];
let flushing = false;

app.post("/api/log", (req, res) => {
  const { userId, target, status = "OK", key = "" } = req.body || {};
  if (!userId || !target) return res.status(400).json({ error: "missing fields" });
  writeQueue.push({ ts: new Date(), userId, target, status, key });
  res.json({ ok: true });
});

async function flushLoop() {
  if (flushing) return;
  flushing = true;
  try {
    while (writeQueue.length) {
      const batch = writeQueue.splice(0, 200);
      const values = batch.map(b => [
        b.ts.toISOString().replace("T", " ").replace("Z", ""),
        b.userId,
        b.target,
        b.status,
        b.key
      ]);
      await retry(async () => {
        const sheets = await getSheets();
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: "通關紀錄!A:E", // A:時間 B:userId C:target D:status E:key
          valueInputOption: "USER_ENTERED",
          requestBody: { values }
        });
      }, 5, 120);
      await sleep(150);
    }
  } catch (e) {
    console.error("flushLoop error:", e.message);
  } finally {
    flushing = false;
  }
}

setInterval(flushLoop, 500);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function retry(fn, tries=5, base=100){
  let t=0, last;
  while (t++ < tries) {
    try { return await fn(); }
    catch(e){ last=e; await sleep(base * (2 ** (t-1))); }
  }
  throw last;
}

function normalizeText(v = "") {
  return (v ?? "").toString().trim();
}

function columnToLetter(index = 1) {
  let col = "";
  let i = Number(index);
  while (i > 0) {
    const rem = (i - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    i = Math.floor((i - 1) / 26);
  }
  return col;
}

async function fetchPlayerRows() {
  const sheets = await getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYER_SHEET_ID,
    range: PLAYER_SHEET_RANGE
  });
  const values = resp.data.values || [];
  const rows = values.length > 1 ? values.slice(1) : [];
  return { rows, sheets };
}

app.post("/api/register", async (req, res) => {
  const sid = normalizeText(req.body?.sid);
  const name = normalizeText(req.body?.name);
  const email = normalizeText(req.body?.email);

  if (!sid || !name || !email) {
    return res.status(400).json({ error: "missing_fields" });
  }

  try {
    const { rows, sheets } = await fetchPlayerRows();
    const idx = rows.findIndex(row => normalizeText(row[1]) === sid);
    const safeTimestamp = new Date().toISOString().replace("T", " ").replace("Z", "");

    if (idx >= 0) {
      const row = rows[idx];
      const rowNumber = idx + 2;
      const existingName = normalizeText(row[2]);
      if (existingName && existingName !== name) {
        return res.status(409).json({ error: "NAME_MISMATCH" });
      }

      const existingEmail = normalizeText(row[3]);
      if (existingName !== name || existingEmail !== email) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: PLAYER_SHEET_ID,
          range: `${PLAYER_SHEET_TAB}!B${rowNumber}:D${rowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[sid, name, email]] }
        });
      }

      const mission1Passed = normalizeText(row[4]).toLowerCase() === "pass";
      return res.json({ ok: true, existed: true, mission1Passed });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: PLAYER_SHEET_ID,
      range: PLAYER_SHEET_RANGE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[safeTimestamp, sid, name, email, ""]] }
    });

    res.json({ ok: true, existed: false, mission1Passed: false });
  } catch (e) {
    console.error("register error", e.message);
    res.status(500).json({ error: "REGISTER_FAILED" });
  }
});

app.post("/api/mission-progress", async (req, res) => {
  const sid = normalizeText(req.body?.sid);
  const name = normalizeText(req.body?.name);
  const mission = normalizeText(req.body?.mission || "mission1") || "mission1";
  const status = normalizeText(req.body?.status || "pass") || "pass";

  if (!sid || !name) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const columnIndex = PLAYER_MISSION_COLUMNS[mission];
  if (!columnIndex) {
    return res.status(400).json({ error: "MISSION_UNSUPPORTED" });
  }

  try {
    const { rows, sheets } = await fetchPlayerRows();
    const idx = rows.findIndex(row => normalizeText(row[1]) === sid);
    if (idx < 0) {
      return res.status(404).json({ error: "NOT_REGISTERED" });
    }
    const row = rows[idx];
    const existingName = normalizeText(row[2]);
    if (existingName && existingName !== name) {
      return res.status(409).json({ error: "NAME_MISMATCH" });
    }

    const existingStatus = normalizeText(row[columnIndex - 1]).toLowerCase();
    if (existingStatus === status.toLowerCase()) {
      return res.json({ ok: true, updated: false });
    }

    const rowNumber = idx + 2;
    const letter = columnToLetter(columnIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: PLAYER_SHEET_ID,
      range: `${PLAYER_SHEET_TAB}!${letter}${rowNumber}:${letter}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] }
    });

    res.json({ ok: true, updated: true });
  } catch (e) {
    console.error("mission-progress error", e.message);
    res.status(500).json({ error: "MISSION_SAVE_FAILED" });
  }
});

// ============== STATIC FILES ==============
app.use(express.static("public"));

// Health check
app.get("/healthz", (req, res) => {
  res.json({
    cache_age_ms: Date.now() - (cache.at || 0),
    cache_rows: cache.rows ? cache.rows.length : 0,
    queue_depth: writeQueue.length
  });
});

app.listen(PORT, () => {
  console.log("Server on http://localhost:" + PORT);
  // 啟動預熱
  refreshCache().catch(() => {});
});
