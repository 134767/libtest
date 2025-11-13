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
