// assets/js/app.js
export const API_BASE = "";
export const ACADEMY_ORDER = [
  "01文","02藝","03傳","04教","05醫","06理",
  "07外","08民","09法","10社","11管","12織"
];
export const LABELS = {
  "01文":"文學院","02藝":"藝術學院","03傳":"傳播學院","04教":"教運學院",
  "05醫":"醫學院","06理":"理工學院","07外":"外語學院","08民":"民生學院",
  "09法":"法律學院","10社":"社會學院","11管":"管理學院","12織":"織品學院"
};
export const ACADEMIES = Object.fromEntries(ACADEMY_ORDER.map(code => ([
  code,{ code, label: LABELS[code], png:`./icon/png/${code}.png`, jpg:`./icon/jpgdata/${code}.jpg` }
])));
export function sessionId(){
  let id = localStorage.getItem("sessionId");
  if(!id){
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("sessionId", id);
  }
  return id;
}
export async function apiGetTask(target){
  const url = `${API_BASE}/api/task?target=${encodeURIComponent(target)}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(await r.text());
  return await r.json();
}
export async function apiLog({userId, target, status="OK", key=""}){
  const url = `${API_BASE}/api/log`;
  await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ userId, target, status, key }) });
}
export function setProgress(p){ try{ localStorage.setItem("progress", String(p)); }catch(e){} }
export function go(href){ window.location.href = href; }
export function openAR(forceCode){
  const u = new URL("./scanner.html", location.href);
  if(forceCode) u.searchParams.set("force", forceCode);
  window.location.href = u.toString();
}
export function renderAcademyButtons(container,{onLoadTask}={}){
  container.innerHTML = "";
  ACADEMY_ORDER.forEach(code=>{
    const meta = ACADEMIES[code];
    const card=document.createElement("div");
    card.className="card";
    card.innerHTML=`
      <img src="${meta.jpg}" alt="${meta.label}" style="width:100%;border-radius:10px"/>
      <h3>${meta.label}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="button" data-load="${code}">載入任務</button>
        <button class="button" data-ar="${code}">開啟 AR 掃描</button>
      </div>`;
    container.appendChild(card);
    card.querySelector("[data-load]").addEventListener("click",()=>onLoadTask?.(code,meta));
    card.querySelector("[data-ar]").addEventListener("click",()=>openAR(code));
  });
}
