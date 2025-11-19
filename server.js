import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(express.json());

// CORS 設定
const allow = process.env.ALLOW_ORIGIN;
app.use(cors(allow ? { origin: allow } : {}));

// === 環境參數 ===
const SHEET_ID = process.env.SHEET_ID;                    // 總資料庫 Sheet（通關紀錄、任務文字）
const KEYFILE = process.env.GOOGLE_SA_KEYFILE || "./service-account.json";
const PORT = process.env.PORT || 8787;

// 玩家資料專用 Sheet（可與 SHEET_ID 相同）
const PLAYER_SHEET_ID = process.env.PLAYER_SHEET_ID || SHEET_ID;
const PLAYER_SHEET_TAB = process.env.PLAYER_SHEET_TAB || "玩家資料";
const PLAYER_SHEET_RANGE = `${PLAYER_SHEET_TAB}!A:E`;

// 任務欄位對應（1-based column index）
const PLAYER_MISSION_COLUMNS = {
  mission1: 5, // E 欄
};

if (!SHEET_ID) {
  console.error("Missing SHEET_ID in .env");
  process.exit(1);
}
if (!fs.existsSync(KEYFILE)) {
  console.warn("[Warn] KEYFILE not found yet:", KEYFILE);
}

// === Google Sheets client ===
async function getSheets() {
  const credentialsRaw = fs.readFileSync(KEYFILE, "utf-8");
  const credentials = JSON.parse(credentialsRaw);
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    credentials,
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ============== 任務內容 READ CACHE (SWR) ==============
let cache = { rows: null, at: 0, headers: null };
const TTL = 10_000; // 10 秒

async function refreshCache() {
  const sheets = await getSheets();
  const range = "資料庫!A:Z"; // 讀到 Z 欄，之後擴表不用改程式
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  const values = resp.data.values || [];
  const headers = values[0] || [];
  const rows = values.length > 1 ? values.slice(1) : [];
  cache = { rows, headers, at: Date.now() };
}

function rowToObj(headers, row) {
  const o = {};
  headers.forEach((h, i) => {
    o[h || `COL${i + 1}`] = row[i] ?? "";
  });
  return o;
}

function pickByTarget(target) {
  const t = String(target || "").trim();
  if (!cache.rows) return null;
  const idx = cache.rows.findIndex((r) => (r[0] || "").trim() === t);
  if (idx < 0) return null;
  return rowToObj(cache.headers, cache.rows[idx]);
}

// 取得任務描述：/api/task?target=01文..12織
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

// ============== 通關紀錄寫入 Queue (通關紀錄!A:E) ==============
const writeQueue = [];
let flushing = false;

app.post("/api/log", (req, res) => {
  const { userId, target, status = "OK", key = "" } = req.body || {};
  if (!userId || !target) {
    return res.status(400).json({ error: "missing fields" });
  }
  writeQueue.push({ ts: new Date(), userId, target, status, key });
  res.json({ ok: true });
});

async function flushLoop() {
  if (flushing) return;
  flushing = true;
  try {
    while (writeQueue.length) {
      const batch = writeQueue.splice(0, 200);
      const values = batch.map((b) => [
        b.ts.toISOString().replace("T", " ").replace("Z", ""),
        b.userId,
        b.target,
        b.status,
        b.key,
      ]);
      await retry(async () => {
        const sheets = await getSheets();
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: "通關紀錄!A:E", // A:時間 B:userId C:target D:status E:key
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function retry(fn, tries = 5, base = 100) {
  let t = 0,
    last;
  while (t++ < tries) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(base * 2 ** (t - 1));
    }
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

// === 讀取玩家資料表 ===
async function fetchPlayerRows() {
  const sheets = await getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYER_SHEET_ID,
    range: PLAYER_SHEET_RANGE,
  });
  const values = resp.data.values || [];
  const rows = values.length > 1 ? values.slice(1) : [];
  return { rows, sheets };
}

// === 玩家註冊 / 登入 ===
// 規則：
// - 以「學號 + 姓名」驗證。
// - 若找到完全相符 → 視為已註冊，回傳 mission1 是否 pass。
// - 若沒找到，但有「學號或姓名其中之一」已出現在別列 → 視為輸入錯誤，回傳「已註冊，學號&姓名錯誤」。
// - 若完全沒出現過 → 新增一列：A=首次時間戳、B=學號、C=姓名、D=Email（可空）、E=空白。
app.post("/api/register", async (req, res) => {
  const sid = normalizeText(req.body?.sid);
  const name = normalizeText(req.body?.name);
  const email = normalizeText(req.body?.email);

  if (!sid || !name) {
    return res
      .status(400)
      .json({ error: "missing_fields", message: "學號與姓名為必填" });
  }

  try {
    const { rows, sheets } = await fetchPlayerRows();
    const safeTimestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");

    // 1) 找到完全相符：學號 + 姓名
    const matchIndex = rows.findIndex(
      (row) =>
        normalizeText(row[1]) === sid && normalizeText(row[2]) === name
    );

    if (matchIndex >= 0) {
      const row = rows[matchIndex];
      const rowNumber = matchIndex + 2;

      // 若有提供 email，且與原本不同 → 更新 D 欄
      const existingEmail = normalizeText(row[3]);
      if (email && existingEmail !== email) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: PLAYER_SHEET_ID,
          range: `${PLAYER_SHEET_TAB}!D${rowNumber}:D${rowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[email]] },
        });
      }

      const mission1Passed =
        normalizeText(row[4]).toLowerCase() === "pass";

      return res.json({
        ok: true,
        existed: true,
        mission1Passed,
      });
    }

    // 2) 沒有完全相符 → 檢查是否有「衝突」
    let sidExists = false;
    let nameExists = false;
    for (const row of rows) {
      if (normalizeText(row[1]) === sid) sidExists = true;
      if (normalizeText(row[2]) === name) nameExists = true;
    }

    if (sidExists || nameExists) {
      // 已註冊，但這次輸入的學號/姓名組合跟原本不符
      return res.status(409).json({
        error: "REGISTER_MISMATCH",
        message: "已註冊，學號&姓名錯誤",
      });
    }

    // 3) 完全沒出現過 → 新增一列
    await sheets.spreadsheets.values.append({
      spreadsheetId: PLAYER_SHEET_ID,
      range: PLAYER_SHEET_RANGE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[safeTimestamp, sid, name, email || "", ""]],
      },
    });

    res.json({
      ok: true,
      existed: false,
      mission1Passed: false,
    });
  } catch (e) {
    console.error("register error", e.message);
    res
      .status(500)
      .json({ error: "REGISTER_FAILED", message: "註冊失敗，請稍後再試" });
  }
});

// === 任務進度寫入 (目前支援 mission1) ===
// - 以學號找到玩家列（每個學號唯一）
// - 姓名不符則回傳 NAME_MISMATCH
// - 寫入指定任務欄位，例如 mission1 對應 E 欄
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
    const idx = rows.findIndex((row) => normalizeText(row[1]) === sid);
    if (idx < 0) {
      return res.status(404).json({ error: "NOT_REGISTERED" });
    }
    const row = rows[idx];
    const existingName = normalizeText(row[2]);
    if (existingName && existingName !== name) {
      return res.status(409).json({ error: "NAME_MISMATCH" });
    }

    const existingStatus = normalizeText(
      row[columnIndex - 1]
    ).toLowerCase();
    if (existingStatus === status.toLowerCase()) {
      return res.json({ ok: true, updated: false });
    }

    const rowNumber = idx + 2;
    const letter = columnToLetter(columnIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: PLAYER_SHEET_ID,
      range: `${PLAYER_SHEET_TAB}!${letter}${rowNumber}:${letter}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] },
    });

    res.json({ ok: true, updated: true });
  } catch (e) {
    console.error("mission-progress error", e.message);
    res
      .status(500)
      .json({ error: "MISSION_SAVE_FAILED", message: "進度儲存失敗" });
  }
});

// ============== STATIC FILES ==============
app.use(express.static("public"));

// Health check
app.get("/healthz", (req, res) => {
  res.json({
    cache_age_ms: Date.now() - (cache.at || 0),
    cache_rows: cache.rows ? cache.rows.length : 0,
    queue_depth: writeQueue.length,
  });
});

app.listen(PORT, () => {
  console.log("Server on http://localhost:" + PORT);
  // 預熱任務資料 cache
  refreshCache().catch(() => {});
});
