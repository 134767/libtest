// assets/js/app.js

// 伺服器位址，若部署在同一網域可留空字串
export const API_BASE = "";

// 學院代碼固定順序
export const ACADEMY_ORDER = [
  "01文","02藝","03傳","04教","05醫","06理",
  "07外","08民","09法","10社","11管","12織"
];

// 學院代碼 → 中文名稱
export const LABELS = {
  "01文":"文學院","02藝":"藝術學院","03傳":"傳播學院","04教":"教運學院",
  "05醫":"醫學院","06理":"理工學院","07外":"外語學院","08民":"民生學院",
  "09法":"法律學院","10社":"社會學院","11管":"管理學院","12織":"織品學院"
};

// 方便取得每一個學院的 jpg / png
export const ACADEMIES = Object.fromEntries(
  ACADEMY_ORDER.map(code => ([
    code,
    {
      code,
      label: LABELS[code],
      png: `./icon/png/${code}.png`,
      jpg: `./icon/jpgdata/${code}.jpg`
    }
  ]))
);

// 生成 / 取得 sessionId（寫在 localStorage）
export function sessionId(){
  let id = localStorage.getItem("sessionId");
  if(!id){
    id = "S-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try{ localStorage.setItem("sessionId", id); }catch(e){}
  }
  return id;
}

// 取得某個 target（01文..12織）的任務說明
export async function apiGetTask(target){
  const t = (target || "").trim();
  if(!t) throw new Error("缺少 target 參數");
  const url = `${API_BASE}/api/task?target=${encodeURIComponent(t)}`;
  const r = await fetch(url);
  if(!r.ok){
    throw new Error(await r.text());
  }
  return await r.json();
}

// 寫入通關紀錄（寫到 Google Sheet：通關紀錄）
export async function apiLog({userId, target, status="OK", key=""}){
  const url = `${API_BASE}/api/log`;
  await fetch(url, {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ userId, target, status, key })
  });
}

// 記錄進度（百分比）到 localStorage
export function setProgress(p){
  try{
    localStorage.setItem("progress", String(p));
  }catch(e){}
}

// 讀取進度（0~100），若沒有就回 0
export function getProgress(){
  const raw = localStorage.getItem("progress");
  const n = Number(raw);
  if(Number.isFinite(n) && n>=0 && n<=100) return n;
  return 0;
}

// 簡單導頁
export function go(href){
  window.location.href = href;
}

// 共用的「開啟 AR 掃描」入口
// forceCode 例如 "03傳"、"12織"
export function openAR(forceCode){
  const u = new URL("./scanner.html", location.href);
  if(forceCode){
    u.searchParams.set("force", forceCode);
  }
  window.location.href = u.toString();
}

// 產生首頁 / 選單用的學院卡片按鈕
// container: DOM 節點
// onLoadTask: 點「載入任務」時的 callback
export function renderAcademyButtons(container,{onLoadTask}={}){
  if(!container) return;
  container.innerHTML = "";

  ACADEMY_ORDER.forEach(code=>{
    const meta = ACADEMIES[code];
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${meta.jpg}" alt="${meta.label}" style="width:100%;border-radius:10px"/>
      <h3>${meta.label}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="button" data-load="${code}">載入任務</button>
        <button class="button" data-ar="${code}">開啟 AR 掃描</button>
      </div>
    `;
    container.appendChild(card);

    const loadBtn = card.querySelector("[data-load]");
    const arBtn   = card.querySelector("[data-ar]");

    if(loadBtn){
      loadBtn.addEventListener("click", ()=>{
        onLoadTask?.(code, meta);
      });
    }
    if(arBtn){
      arBtn.addEventListener("click", ()=>{
        openAR(code);
      });
    }
  });
}
