// 圖書館無限城冒險 後端網址（GAS Web App）
const AR_API_URL = 'https://script.google.com/macros/s/AKfycbxS55Cvrmig-M6SOffpB381g6pPjta2OeTrbZiwfYOmqiSezpGBRrCJNLxa62dC62QCIA/exec';

// 共用呼叫：避免 CORS，故不要手動加 Content-Type
async function callArApi(payload) {
  const res = await fetch(AR_API_URL, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('API 回傳不是合法 JSON：', text);
    throw new Error('後端回傳格式錯誤');
  }
  return json;
}

// 首頁登入 / 註冊
async function registerPlayer(sid, name, email) {
  const payload = {
    action: 'register',
    sid,
    name,
    email
  };
  return await callArApi(payload);
}

// 更新任務進度
async function updateMissionProgress(sid, name, mission, value) {
  const payload = {
    action: 'updateProgress',
    sid,
    name,
    mission, // 'mission1' / 'mission2' / 'mission3' / 'biz' / 'finish'
    value
  };
  return await callArApi(payload);
}

// 把玩家資料存到 localStorage，方便任務頁面使用
function savePlayerToLocal(profile, progress) {
  localStorage.setItem('arPlayerProfile', JSON.stringify(profile));
  localStorage.setItem('arPlayerProgress', JSON.stringify(progress));
}

function loadPlayerProfile() {
  const raw = localStorage.getItem('arPlayerProfile');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function loadPlayerProgress() {
  const raw = localStorage.getItem('arPlayerProgress');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
