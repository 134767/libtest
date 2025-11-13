# AR 草案接 Google Sheet — 測試版

這是一個可直接部署的最小可用 (MVP) 專案：
- 前端：GitHub Pages 風格的純靜態頁面 (`public/`)
- 後端：Node/Express (`server.js`) 以 Service Account 讀寫 Google Sheet
- 資料庫：Google Sheet（ID 由 `.env` 指定，預設範例已填入）

## 目錄
```
ar-sheet-draft/
├─ server.js
├─ package.json
├─ .env.example
├─ service-account.example.json
├─ README.md
└─ public/
   ├─ index.html
   ├─ ar.html
   ├─ app.js
   ├─ style.css
   ├─ targets.mind           # 請把你的 targets.mind 放這裡
   └─ icon/
      ├─ jpgdata/            # 12 張 jpg (01文..12織)
      ├─ png/                # 12 張 png 透明框 (01文..12織)
      └─ Universal/
         └─ loading.png
```

## 安裝與啟動
1. 下載本專案並安裝相依：
   ```bash
   npm install
   ```
2. 建立 `.env`：
   ```bash
   cp .env.example .env
   # 編輯 .env，確認 SHEET_ID 與金鑰路徑
   ```
3. 放入 Service Account 金鑰檔：
   ```bash
   cp service-account.example.json service-account.json
   # 用你的 Google Cloud 服務帳戶金鑰內容覆蓋
   ```
   並到 Google Sheet 將 **service-account 的信箱**加入「可編輯」權限。

4. 將 `public/targets.mind` 換成你的檔案；把 `icon/jpgdata` 與 `icon/png`、`icon/Universal/loading.png` 放入。

5. 啟動：
   ```bash
   npm run dev
   ```
   本機預設埠：`http://localhost:8787`

## API
- `GET /api/task?target=01文`：從工作表「資料庫」找第一欄等於 target 的資料列；回傳 JSON（以標題列為 key）。
- `POST /api/log`：寫入通關紀錄（時間、userId、target、status、key）。

## 前端使用
- `index.html` 有 12 個學院按鈕 + 「開啟 AR 掃描」按鈕。
- `ar.html` 啟動 MindAR 並根據偵測到的 target（對應 `01文..12織`）
  - 顯示對應 PNG 透明框
  - 呼叫 `/api/task` 取得任務資訊
  - 呼叫 `/api/log` 留存認證紀錄

## 注意
- 若你要部署前端到 GitHub Pages，**後端必須部署在可公開的 Node 主機**（Render/Railway/Fly.io/Cloud Run…），並在 `public/app.js` 的 `API_BASE` 改成你的網域。
- 尖峰 100 人同時使用已透過快取與佇列批次寫入處理。

