// === 配置 ===
// 將這個改成你的已部署後端網址（本機開發則留空字串即可）
const API_BASE = ""; // 例如 "https://your-api.example.com"

// 學院順序（與 targets.mind 生成順序一致）
window.ACADEMY_ORDER = [
  "01文","02藝","03傳","04教","05醫","06理",
  "07外","08民","09法","10社","11管","12織"
];

// 學院對照（png overlay 與中文標籤）
window.ACADEMIES = Object.fromEntries(window.ACADEMY_ORDER.map(code => {
  const labels = {
    "01文":"文學院","02藝":"藝術學院","03傳":"傳播學院","04教":"教運學院",
    "05醫":"醫學院","06理":"理工學院","07外":"外語學院","08民":"民生學院",
    "09法":"法律學院","10社":"社會學院","11管":"管理學院","12織":"織品學院"
  };
  return [code, {
    label: labels[code] || code,
    png: `./icon/png/${code}.png`,
    jpg: `./icon/jpgdata/${code}.jpg`
  }];
}));

// 產生 sessionId 用於 log
window.sessionId = function() {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("sessionId", id);
  }
  return id;
};

// API helpers
window.apiGetTask = async function(target){
  const url = `${API_BASE}/api/task?target=${encodeURIComponent(target)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
};
window.apiLog = async function(payload){
  const url = `${API_BASE}/api/log`;
  await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
};

// ==== index.html 專用：渲染 12 個學院卡片 ====
(function initIndex(){
  const list = document.getElementById("academy-list");
  if (!list) return;
  const loading = document.getElementById("loading");
  const panel = document.getElementById("task-panel");
  const titleEl = document.getElementById("task-title");
  const descEl  = document.getElementById("task-desc");
  const btnAR   = document.getElementById("btn-ar");
  let currentTarget = null;

  window.ACADEMY_ORDER.forEach(code => {
    const meta = window.ACADEMIES[code];
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <img src="${meta.jpg}" alt="${meta.label}" style="width:100%; border-radius:10px;"/>
      <h3>${meta.label}</h3>
      <div class="btns">
        <button class="primary" data-code="${code}">載入任務</button>
        <a class="secondary" href="./ar.html" data-ar>開啟 AR 掃描</a>
      </div>
    `;
    list.appendChild(el);

    el.querySelector("button[data-code]").addEventListener("click", async (ev) => {
      const code = ev.currentTarget.getAttribute("data-code");
      currentTarget = code;
      loading.classList.remove("hidden");
      try {
        const data = await window.apiGetTask(code);
        titleEl.textContent = data["名稱"] || data["name"] || `${meta.label} 任務`;
        descEl.textContent  = data["說明"] || data["desc"] || "（待補說明）";
        panel.classList.remove("hidden");
      } catch (e) {
        titleEl.textContent = `${meta.label} 任務未找到`;
        descEl.textContent  = "";
        panel.classList.remove("hidden");
      } finally {
        loading.classList.add("hidden");
      }
    });

    el.querySelector("[data-ar]").addEventListener("click", (ev) => {
      // 預設直接前往 ar.html，由 AR 辨識決定 target
      // 如需指定當前目標，可改為 `ar.html?force=01文`
    });
  });

  btnAR?.addEventListener("click", () => {
    window.location.href = "./ar.html";
  });
})();
