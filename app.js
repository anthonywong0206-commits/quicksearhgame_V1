const STORAGE_KEY = "spot_the_difference_single_img_v3";

function createDefaultStage(index = 1) {
  return {
    id: "stage_" + Date.now() + "_" + index,
    name: `第 ${index} 關`,
    timeLimit: 60,
    maxClicks: 10,
    defaultSpotScore: 10,
    mirrorMode: "auto-half", // 'auto-half'（左右半幅自動對稱鏡像） | 'single-only'
    compareImage: "", // 單張包含左右對比畫面的圖片
    spots: [] // { id, x, y, r, score } 其中 x, y 為整張對比圖 0~1 的比例座標
  };
}

let gameConfig = {
  title: "大家來找茬挑戰賽",
  adminPassword: "",
  timerMode: "per-stage", // 'per-stage' | 'global' | 'none'
  globalTimeLimit: 120,
  wrongBehavior: "feedback", // 'feedback' | 'silent'
  stages: [createDefaultStage(1)]
};

let playState = {
  currentStageIdx: 0,
  totalScore: 0,
  stageScore: 0,
  foundIds: new Set(),
  clicksUsed: 0,
  remainingTime: 0,
  timerInterval: null,
  isOver: false
};

let adminState = {
  isUnlocked: false,
  editingStageIdx: 0
};

let drawState = {
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentR: 0
};

// ==================== 初始化 ====================
document.addEventListener("DOMContentLoaded", async () => {
  await loadInitialConfig();
  bindEvents();
  syncAdminGlobalForm();
  renderAdminWorkspace();
  startFullChallenge();
});

async function loadInitialConfig() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.stages) && parsed.stages.length > 0) {
        gameConfig = { ...gameConfig, ...parsed };
        return;
      }
    } catch (e) {
      console.warn("讀取本機設定失敗", e);
    }
  }

  try {
    const res = await fetch("./game-config.json", { cache: "no-store" });
    if (res.ok) {
      const remoteData = await res.json();
      if (remoteData && Array.isArray(remoteData.stages) && remoteData.stages.length > 0) {
        gameConfig = { ...gameConfig, ...remoteData };
      }
    }
  } catch (e) {
    // 若無外部設定檔則等待上傳或載入示範
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 2600);
}

// 計算某個標記點的另一側鏡像 X 座標（左半幅 <-> 右半幅）
function getMirroredX(x) {
  return x < 0.5 ? x + 0.5 : x - 0.5;
}

// ==================== 事件綁定 ====================
function bindEvents() {
  document.getElementById("btn-mode-play").addEventListener("click", () => switchMode("play"));
  document.getElementById("btn-mode-admin").addEventListener("click", requestAdminAccess);
  document.getElementById("btn-goto-admin").addEventListener("click", requestAdminAccess);

  document.getElementById("btn-pwd-submit").addEventListener("click", verifyAdminPassword);
  document.getElementById("admin-pwd-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") verifyAdminPassword();
  });
  document.getElementById("btn-pwd-cancel").addEventListener("click", () => {
    document.getElementById("password-modal").classList.add("hidden");
  });

  document.getElementById("btn-restart-stage").addEventListener("click", () => {
    playState.totalScore = Math.max(0, playState.totalScore - playState.stageScore);
    startStage(playState.currentStageIdx, true);
  });
  document.getElementById("btn-restart-all").addEventListener("click", startFullChallenge);
  document.getElementById("btn-load-demo").addEventListener("click", loadMultiStageDemo);

  document.getElementById("btn-modal-next").addEventListener("click", () => {
    document.getElementById("result-modal").classList.add("hidden");
    startStage(playState.currentStageIdx + 1, false);
  });
  document.getElementById("btn-modal-replay-stage").addEventListener("click", () => {
    document.getElementById("result-modal").classList.add("hidden");
    playState.totalScore = Math.max(0, playState.totalScore - playState.stageScore);
    startStage(playState.currentStageIdx, true);
  });
  document.getElementById("btn-modal-replay-all").addEventListener("click", () => {
    document.getElementById("result-modal").classList.add("hidden");
    startFullChallenge();
  });

  // 玩家點擊單張對比圖
  document.getElementById("play-wrapper").addEventListener("click", handlePlayerClick);

  // 後台全域設定
  document.getElementById("cfg-game-title").addEventListener("input", (e) => {
    gameConfig.title = e.target.value || "大家來找茬挑戰賽";
  });
  document.getElementById("cfg-admin-pwd").addEventListener("input", (e) => {
    gameConfig.adminPassword = e.target.value.trim();
  });
  document.getElementById("cfg-timer-mode").addEventListener("change", (e) => {
    gameConfig.timerMode = e.target.value;
    toggleGlobalTimeInput();
  });
  document.getElementById("cfg-global-seconds").addEventListener("change", (e) => {
    gameConfig.globalTimeLimit = Math.max(10, parseInt(e.target.value || "120", 10));
  });
  document.getElementById("cfg-wrong-behavior").addEventListener("change", (e) => {
    gameConfig.wrongBehavior = e.target.value;
  });

  // 多關卡列表管理
  document.getElementById("btn-add-stage").addEventListener("click", () => {
    const newStage = createDefaultStage(gameConfig.stages.length + 1);
    gameConfig.stages.push(newStage);
    adminState.editingStageIdx = gameConfig.stages.length - 1;
    renderAdminWorkspace();
    showToast(`已新增「${newStage.name}」`);
  });

  document.getElementById("btn-delete-stage").addEventListener("click", () => {
    if (gameConfig.stages.length <= 1) {
      showToast("⚠️ 至少需保留 1 個關卡");
      return;
    }
    gameConfig.stages.splice(adminState.editingStageIdx, 1);
    adminState.editingStageIdx = Math.max(0, adminState.editingStageIdx - 1);
    renderAdminWorkspace();
    showToast("已刪除此關卡");
  });

  // 單關卡設定欄位
  document.getElementById("stage-name").addEventListener("input", (e) => {
    const stage = getCurrentEditingStage();
    stage.name = e.target.value || `第 ${adminState.editingStageIdx + 1} 關`;
    renderStageTabs();
    document.getElementById("editing-stage-label").textContent = stage.name;
  });
  document.getElementById("stage-time").addEventListener("change", (e) => {
    getCurrentEditingStage().timeLimit = Math.max(5, parseInt(e.target.value || "60", 10));
  });
  document.getElementById("stage-clicks").addEventListener("change", (e) => {
    getCurrentEditingStage().maxClicks = Math.max(0, parseInt(e.target.value || "0", 10));
  });
  document.getElementById("stage-default-score").addEventListener("change", (e) => {
    getCurrentEditingStage().defaultSpotScore = Math.max(1, parseInt(e.target.value || "10", 10));
  });
  document.getElementById("stage-mirror-mode").addEventListener("change", (e) => {
    getCurrentEditingStage().mirrorMode = e.target.value;
    renderAdminWorkspace();
  });

  // 上傳單張對比圖
  document.getElementById("upload-compare-img").addEventListener("change", handleSingleImageUpload);
  document.getElementById("btn-clear-spots").addEventListener("click", () => {
    getCurrentEditingStage().spots = [];
    renderAdminWorkspace();
    showToast("已清空本關標記");
  });

  // 儲存與匯出匯入
  document.getElementById("btn-save-local").addEventListener("click", () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gameConfig));
      showToast("✅ 已儲存全部關卡與設定！");
      switchMode("play");
    } catch (err) {
      showToast("⚠️ 儲存空間不足，請點擊「匯出 JSON」保存設定。");
    }
  });
  document.getElementById("btn-export-json").addEventListener("click", exportConfigJson);
  document.getElementById("import-json").addEventListener("change", importConfigJson);

  // 單圖圈選繪圖事件
  setupDrawingEvents("admin-wrapper");
}

// ==================== 後台密碼鎖 ====================
function requestAdminAccess() {
  if (!gameConfig.adminPassword || adminState.isUnlocked) {
    switchMode("admin");
    return;
  }
  const pwdModal = document.getElementById("password-modal");
  const pwdInput = document.getElementById("admin-pwd-input");
  const errMsg = document.getElementById("pwd-error-msg");
  pwdInput.value = "";
  errMsg.classList.add("hidden");
  pwdModal.classList.remove("hidden");
  setTimeout(() => pwdInput.focus(), 50);
}

function verifyAdminPassword() {
  const inputVal = document.getElementById("admin-pwd-input").value;
  if (inputVal === gameConfig.adminPassword) {
    adminState.isUnlocked = true;
    document.getElementById("password-modal").classList.add("hidden");
    switchMode("admin");
    showToast("🔓 後台已解鎖");
  } else {
    document.getElementById("pwd-error-msg").classList.remove("hidden");
  }
}

function switchMode(mode) {
  const playView = document.getElementById("play-view");
  const adminView = document.getElementById("admin-view");
  const btnPlay = document.getElementById("btn-mode-play");
  const btnAdmin = document.getElementById("btn-mode-admin");

  stopTimer();

  if (mode === "play") {
    playView.classList.remove("hidden");
    adminView.classList.add("hidden");
    btnPlay.classList.add("active");
    btnAdmin.classList.remove("active");
    startFullChallenge();
  } else {
    adminView.classList.remove("hidden");
    playView.classList.add("hidden");
    btnAdmin.classList.add("active");
    btnPlay.classList.remove("active");
    syncAdminGlobalForm();
    renderAdminWorkspace();
  }
}

// ==================== 多關卡遊戲與倒數計時核心 ====================
function startFullChallenge() {
  stopTimer();
  playState.currentStageIdx = 0;
  playState.totalScore = 0;
  if (gameConfig.timerMode === "global") {
    playState.remainingTime = gameConfig.globalTimeLimit || 120;
  }
  startStage(0, false);
}

function startStage(stageIdx, isRetry) {
  stopTimer();
  const stages = gameConfig.stages;
  if (!stages || stages.length === 0) return;

  playState.currentStageIdx = Math.min(stageIdx, stages.length - 1);
  const currentStage = stages[playState.currentStageIdx];

  document.getElementById("game-title-display").textContent = gameConfig.title || "大家來找茬挑戰賽";
  document.getElementById("stage-subtitle-display").textContent =
    `${currentStage.name} (${playState.currentStageIdx + 1}/${stages.length})`;

  const emptyState = document.getElementById("empty-state");
  const gameStage = document.getElementById("game-stage");

  if (!currentStage.compareImage) {
    emptyState.classList.remove("hidden");
    gameStage.classList.add("hidden");
    updateHud();
    return;
  }

  emptyState.classList.add("hidden");
  gameStage.classList.remove("hidden");

  playState.stageScore = 0;
  playState.foundIds = new Set();
  playState.clicksUsed = 0;
  playState.isOver = false;

  if (gameConfig.timerMode === "per-stage") {
    playState.remainingTime = currentStage.timeLimit || 60;
  } else if (gameConfig.timerMode === "global" && isRetry && playState.remainingTime <= 0) {
    playState.remainingTime = gameConfig.globalTimeLimit || 120;
  }

  document.getElementById("play-img").src = currentStage.compareImage;
  document.getElementById("play-overlay").innerHTML = "";

  updateHud();
  startTimerIfNeeded();
}

function startTimerIfNeeded() {
  stopTimer();
  if (gameConfig.timerMode === "none") return;

  playState.timerInterval = setInterval(() => {
    if (playState.isOver) {
      stopTimer();
      return;
    }
    playState.remainingTime -= 1;
    updateHud();

    if (playState.remainingTime <= 0) {
      playState.remainingTime = 0;
      stopTimer();
      triggerGameOverModal(false, "⏰ 時間到！", "倒數計時已結束，挑戰未能完成。");
    }
  }, 1000);
}

function stopTimer() {
  if (playState.timerInterval) {
    clearInterval(playState.timerInterval);
    playState.timerInterval = null;
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateHud() {
  const stages = gameConfig.stages;
  const currentStage = stages[playState.currentStageIdx] || { spots: [], maxClicks: 0 };

  document.getElementById("hud-stage").textContent = `${playState.currentStageIdx + 1} / ${stages.length}`;
  document.getElementById("hud-score").textContent = playState.totalScore;
  document.getElementById("hud-found").textContent = playState.foundIds.size;
  document.getElementById("hud-total").textContent = currentStage.spots.length;

  const timerEl = document.getElementById("hud-timer");
  if (gameConfig.timerMode === "none") {
    timerEl.textContent = "∞";
    timerEl.classList.remove("danger-pulse");
  } else {
    timerEl.textContent = formatTime(Math.max(0, playState.remainingTime));
    if (playState.remainingTime <= 10) {
      timerEl.classList.add("danger-pulse");
    } else {
      timerEl.classList.remove("danger-pulse");
    }
  }

  const clicksEl = document.getElementById("hud-clicks");
  if (currentStage.maxClicks > 0) {
    const remaining = Math.max(0, currentStage.maxClicks - playState.clicksUsed);
    clicksEl.textContent = remaining;
    clicksEl.style.color = remaining <= 3 ? "var(--danger)" : "inherit";
  } else {
    clicksEl.textContent = "∞";
    clicksEl.style.color = "inherit";
  }
}

function handlePlayerClick(event) {
  const currentStage = gameConfig.stages[playState.currentStageIdx];
  if (!currentStage || playState.isOver || currentStage.spots.length === 0) return;

  const wrapper = event.currentTarget;
  const rect = wrapper.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const clickX = (event.clientX - rect.left) / rect.width;
  const clickY = (event.clientY - rect.top) / rect.height;
  const aspectRatio = rect.width / rect.height;
  const isMirrorEnabled = (currentStage.mirrorMode || "auto-half") === "auto-half";

  let hitSpot = null;
  for (const spot of currentStage.spots) {
    if (playState.foundIds.has(spot.id)) continue;

    // 1. 檢查是否點中原本圈選的圓圈
    const dx1 = (clickX - spot.x) * aspectRatio;
    const dy1 = clickY - spot.y;
    const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

    // 2. 若開啟左右半幅鏡像，同時檢查是否點中另一側的對稱位置
    let dist2 = Infinity;
    if (isMirrorEnabled) {
      const mirrorX = getMirroredX(spot.x);
      const dx2 = (clickX - mirrorX) * aspectRatio;
      dist2 = Math.sqrt(dx2 * dx2 + dy1 * dy1);
    }

    const hitThreshold = spot.r * aspectRatio + 0.012;
    if (dist1 <= hitThreshold || dist2 <= hitThreshold) {
      hitSpot = spot;
      break;
    }
  }

  if (hitSpot) {
    const pts = Number(hitSpot.score) || 0;
    playState.foundIds.add(hitSpot.id);
    playState.stageScore += pts;
    playState.totalScore += pts;
    drawFoundCirclesOnImage(hitSpot, isMirrorEnabled);
    showFloatingScore(clickX, clickY, `+${pts}`);
    updateHud();
    checkStageProgress();
  } else {
    playState.clicksUsed += 1;
    if (gameConfig.wrongBehavior === "feedback") {
      drawWrongCross(clickX, clickY);
    }
    updateHud();
    checkStageProgress();
  }
}

function drawFoundCirclesOnImage(spot, isMirrorEnabled) {
  const svg = document.getElementById("play-overlay");
  const positionsX = isMirrorEnabled ? [spot.x, getMirroredX(spot.x)] : [spot.x];

  positionsX.forEach((posX) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", `${posX * 100}%`);
    circle.setAttribute("cy", `${spot.y * 100}%`);
    circle.setAttribute("r", `${spot.r * 100}%`);
    circle.setAttribute("class", "found-circle");
    svg.appendChild(circle);
  });
}

function showFloatingScore(x, y, text) {
  const svg = document.getElementById("play-overlay");
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("x", `${x * 100}%`);
  label.setAttribute("y", `${y * 100}%`);
  label.setAttribute("class", "score-float");
  label.textContent = text;
  svg.appendChild(label);
  setTimeout(() => label.remove(), 950);
}

function drawWrongCross(x, y) {
  const svg = document.getElementById("play-overlay");
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const size = 13;
  const cx = x * svg.clientWidth;
  const cy = y * svg.clientHeight;

  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", cx - size);
  line1.setAttribute("y1", cy - size);
  line1.setAttribute("x2", cx + size);
  line1.setAttribute("y2", cy + size);
  line1.setAttribute("class", "wrong-mark");

  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", cx + size);
  line2.setAttribute("y1", cy - size);
  line2.setAttribute("x2", cx - size);
  line2.setAttribute("y2", cy + size);
  line2.setAttribute("class", "wrong-mark");

  g.appendChild(line1);
  g.appendChild(line2);
  svg.appendChild(g);
  setTimeout(() => g.remove(), 800);
}

function checkStageProgress() {
  const currentStage = gameConfig.stages[playState.currentStageIdx];
  const totalSpots = currentStage.spots.length;
  const allFound = playState.foundIds.size >= totalSpots && totalSpots > 0;
  const outOfClicks = currentStage.maxClicks > 0 && playState.clicksUsed >= currentStage.maxClicks;

  if (allFound) {
    stopTimer();
    const isLastStage = playState.currentStageIdx >= gameConfig.stages.length - 1;
    if (isLastStage) {
      triggerGameOverModal(
        true,
        "🏆 全部關卡挑戰成功！",
        `太厲害了！你完成了全部 ${gameConfig.stages.length} 個關卡！`,
        true
      );
    } else {
      triggerGameOverModal(
        true,
        `🎉 ${currentStage.name} 過關！`,
        "準備好迎接下一關的挑戰了嗎？",
        false
      );
    }
  } else if (outOfClicks) {
    stopTimer();
    triggerGameOverModal(false, "點擊次數已用完！", "很可惜，本關可用點擊次數已耗盡。");
  }
}

function triggerGameOverModal(isWin, title, desc, isAllComplete = false) {
  playState.isOver = true;
  const currentStage = gameConfig.stages[playState.currentStageIdx];

  document.getElementById("modal-icon").textContent = isWin ? (isAllComplete ? "🏆" : "🎉") : "⏳";
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-desc").textContent = desc;
  document.getElementById("modal-final-score").textContent = playState.totalScore;
  document.getElementById("modal-final-found").textContent =
    `${playState.foundIds.size} / ${currentStage ? currentStage.spots.length : 0}`;

  const btnNext = document.getElementById("btn-modal-next");
  const btnReplayStage = document.getElementById("btn-modal-replay-stage");
  const btnReplayAll = document.getElementById("btn-modal-replay-all");

  btnNext.classList.add("hidden");
  btnReplayStage.classList.add("hidden");
  btnReplayAll.classList.add("hidden");

  if (isWin && !isAllComplete) {
    btnNext.classList.remove("hidden");
  } else if (isWin && isAllComplete) {
    btnReplayAll.classList.remove("hidden");
  } else {
    if (gameConfig.timerMode === "global" && playState.remainingTime <= 0) {
      btnReplayAll.classList.remove("hidden");
    } else {
      btnReplayStage.classList.remove("hidden");
      btnReplayAll.classList.remove("hidden");
    }
  }

  setTimeout(() => document.getElementById("result-modal").classList.remove("hidden"), 350);
}

// ==================== 後台管理與單圖標記 ====================
function getCurrentEditingStage() {
  if (!gameConfig.stages[adminState.editingStageIdx]) {
    adminState.editingStageIdx = 0;
  }
  return gameConfig.stages[adminState.editingStageIdx];
}

function syncAdminGlobalForm() {
  document.getElementById("cfg-game-title").value = gameConfig.title || "";
  document.getElementById("cfg-admin-pwd").value = gameConfig.adminPassword || "";
  document.getElementById("cfg-timer-mode").value = gameConfig.timerMode || "per-stage";
  document.getElementById("cfg-global-seconds").value = gameConfig.globalTimeLimit || 120;
  document.getElementById("cfg-wrong-behavior").value = gameConfig.wrongBehavior || "feedback";
  toggleGlobalTimeInput();
}

function toggleGlobalTimeInput() {
  const mode = document.getElementById("cfg-timer-mode").value;
  document.getElementById("global-time-group").style.display = mode === "global" ? "block" : "none";
}

function renderStageTabs() {
  const listEl = document.getElementById("stage-tabs-list");
  document.getElementById("stage-count-badge").textContent = gameConfig.stages.length;
  listEl.innerHTML = "";

  gameConfig.stages.forEach((st, idx) => {
    const item = document.createElement("div");
    item.className = "stage-tab-item" + (idx === adminState.editingStageIdx ? " active" : "");
    item.innerHTML = `
      <span>${idx + 1}. ${st.name}</span>
      <span class="stage-tab-meta">${st.spots.length} 處不同</span>
    `;
    item.addEventListener("click", () => {
      adminState.editingStageIdx = idx;
      renderAdminWorkspace();
    });
    listEl.appendChild(item);
  });
}

function renderAdminWorkspace() {
  renderStageTabs();
  const stage = getCurrentEditingStage();
  const isMirror = (stage.mirrorMode || "auto-half") === "auto-half";

  document.getElementById("editing-stage-label").textContent = stage.name;
  document.getElementById("stage-name").value = stage.name || "";
  document.getElementById("stage-time").value = stage.timeLimit ?? 60;
  document.getElementById("stage-clicks").value = stage.maxClicks ?? 10;
  document.getElementById("stage-default-score").value = stage.defaultSpotScore || 10;
  document.getElementById("stage-mirror-mode").value = stage.mirrorMode || "auto-half";
  document.getElementById("upload-compare-img").value = "";

  document.getElementById("admin-img").src = stage.compareImage || "";
  const svg = document.getElementById("admin-svg");
  svg.innerHTML = "";

  // 繪製中央輔助對齊線（方便確認左右半幅中線）
  if (stage.compareImage && isMirror) {
    const midLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    midLine.setAttribute("x1", "50%");
    midLine.setAttribute("y1", "0%");
    midLine.setAttribute("x2", "50%");
    midLine.setAttribute("y2", "100%");
    midLine.setAttribute("stroke", "rgba(37, 99, 235, 0.45)");
    midLine.setAttribute("stroke-width", "2");
    midLine.setAttribute("stroke-dasharray", "6,6");
    svg.appendChild(midLine);
  }

  // 繪製已標記的不同點（實線為主標記，虛線為自動鏡像對應區）
  stage.spots.forEach((spot, index) => {
    const mainCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    mainCircle.setAttribute("cx", `${spot.x * 100}%`);
    mainCircle.setAttribute("cy", `${spot.y * 100}%`);
    mainCircle.setAttribute("r", `${spot.r * 100}%`);
    mainCircle.setAttribute("fill", "rgba(37, 99, 235, 0.25)");
    mainCircle.setAttribute("stroke", "#2563eb");
    mainCircle.setAttribute("stroke-width", "3");
    svg.appendChild(mainCircle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", `${spot.x * 100}%`);
    text.setAttribute("y", `${spot.y * 100}%`);
    text.setAttribute("dy", "5");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("stroke", "#1e3a8a");
    text.setAttribute("stroke-width", "3");
    text.setAttribute("paint-order", "stroke");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("font-size", "14");
    text.textContent = `#${index + 1}`;
    svg.appendChild(text);

    if (isMirror) {
      const mirrorX = getMirroredX(spot.x);
      const mirrorCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      mirrorCircle.setAttribute("cx", `${mirrorX * 100}%`);
      mirrorCircle.setAttribute("cy", `${spot.y * 100}%`);
      mirrorCircle.setAttribute("r", `${spot.r * 100}%`);
      mirrorCircle.setAttribute("fill", "rgba(22, 163, 74, 0.14)");
      mirrorCircle.setAttribute("stroke", "#16a34a");
      mirrorCircle.setAttribute("stroke-width", "2.2");
      mirrorCircle.setAttribute("stroke-dasharray", "5,4");
      svg.appendChild(mirrorCircle);
    }
  });

  // 繪製正在拖曳中的預覽圈
  if (drawState.isDrawing) {
    const preview = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    preview.setAttribute("cx", `${drawState.startX * 100}%`);
    preview.setAttribute("cy", `${drawState.startY * 100}%`);
    preview.setAttribute("r", `${drawState.currentR * 100}%`);
    preview.setAttribute("fill", "rgba(22, 163, 74, 0.28)");
    preview.setAttribute("stroke", "#16a34a");
    preview.setAttribute("stroke-width", "2.5");
    preview.setAttribute("stroke-dasharray", "5,4");
    svg.appendChild(preview);
  }

  // 更新下方列表
  const listEl = document.getElementById("spots-list");
  document.getElementById("admin-spot-count").textContent = stage.spots.length;
  listEl.innerHTML = "";

  stage.spots.forEach((spot, index) => {
    const sideLabel = spot.x < 0.5 ? "左側" : "右側";
    const item = document.createElement("div");
    item.className = "spot-item";
    item.innerHTML = `
      <span class="spot-item-info">#${index + 1} (${sideLabel})</span>
      <div>
        <label style="font-size:12px;">得分：</label>
        <input type="number" class="spot-score-input" value="${spot.score}" min="1" data-idx="${index}" />
        <button class="btn btn-danger-outline" style="padding:4px 8px;font-size:12px;" data-del="${index}">刪除</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll(".spot-score-input").forEach((input) => {
    input.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      stage.spots[idx].score = Math.max(1, parseInt(e.target.value || "10", 10));
    });
  });

  listEl.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.del, 10);
      stage.spots.splice(idx, 1);
      renderAdminWorkspace();
    });
  });
}

function handleSingleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600; // 單張左右並排圖寬度較寬，保留 1600px 高清畫質
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      getCurrentEditingStage().compareImage = canvas.toDataURL("image/jpeg", 0.85);
      renderAdminWorkspace();
      showToast("對比圖片已載入，請在其中一側圈出不同之處");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupDrawingEvents(wrapperId) {
  const wrapper = document.getElementById(wrapperId);

  wrapper.addEventListener("pointerdown", (e) => {
    const stage = getCurrentEditingStage();
    if (!stage.compareImage) return;
    const rect = wrapper.getBoundingClientRect();
    drawState = {
      isDrawing: true,
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      currentR: 0.02
    };
    wrapper.setPointerCapture(e.pointerId);
    renderAdminWorkspace();
  });

  wrapper.addEventListener("pointermove", (e) => {
    if (!drawState.isDrawing) return;
    const rect = wrapper.getBoundingClientRect();
    const curX = (e.clientX - rect.left) / rect.width;
    const curY = (e.clientY - rect.top) / rect.height;
    const dx = curX - drawState.startX;
    const dy = curY - drawState.startY;
    drawState.currentR = Math.max(0.015, Math.min(0.18, Math.sqrt(dx * dx + dy * dy)));
    renderAdminWorkspace();
  });

  wrapper.addEventListener("pointerup", () => {
    if (!drawState.isDrawing) return;
    const stage = getCurrentEditingStage();
    stage.spots.push({
      id: "spot_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      x: Number(drawState.startX.toFixed(4)),
      y: Number(drawState.startY.toFixed(4)),
      r: Number(drawState.currentR.toFixed(4)),
      score: Number(stage.defaultSpotScore) || 10
    });
    drawState.isDrawing = false;
    renderAdminWorkspace();
  });
}

// ==================== 匯出 / 匯入與多關卡示範 ====================
function exportConfigJson() {
  const blob = new Blob([JSON.stringify(gameConfig, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "game-config.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("已匯出完整多關卡 game-config.json");
}

function importConfigJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data && Array.isArray(data.stages) && data.stages.length > 0) {
        gameConfig = { ...gameConfig, ...data };
        adminState.editingStageIdx = 0;
        syncAdminGlobalForm();
        renderAdminWorkspace();
        showToast(`✅ 成功匯入 ${data.stages.length} 個關卡！`);
      } else {
        showToast("❌ JSON 缺少關卡資料");
      }
    } catch (err) {
      showToast("❌ JSON 格式錯誤");
    }
  };
  reader.readAsText(file);
}

// 內建單張左右對比示範圖（1600x600，左半幅 0~800 為原圖，右半幅 800~1600 為修改圖）
function loadMultiStageDemo() {
  const makeSideBySide1 = () => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">
      <!-- 左半幅 -->
      <g>
        <rect x="0" y="0" width="800" height="600" fill="#bae6fd"/>
        <rect x="0" y="420" width="800" height="180" fill="#86efac"/>
        <circle cx="140" cy="110" r="45" fill="#facc15"/>
        <rect x="260" y="260" width="240" height="180" fill="#fef3c7" stroke="#92400e" stroke-width="4"/>
        <polygon points="240,260 380,150 520,260" fill="#ef4444" stroke="#7f1d1d" stroke-width="4"/>
        <rect x="355" y="340" width="50" height="100" fill="#78350f"/>
        <rect x="290" y="300" width="45" height="45" fill="#38bdf8" stroke="#1e3a8a" stroke-width="3"/>
        <rect x="425" y="300" width="45" height="45" fill="#38bdf8" stroke="#1e3a8a" stroke-width="3"/>
        <rect x="615" y="310" width="30" height="130" fill="#78350f"/>
        <circle cx="630" cy="260" r="70" fill="#22c55e"/>
      </g>
      <!-- 中央分隔線 -->
      <line x1="800" y1="0" x2="800" y2="600" stroke="#ffffff" stroke-width="6"/>
      <!-- 右半幅（太陽變橘色、少一扇右窗） -->
      <g transform="translate(800, 0)">
        <rect x="0" y="0" width="800" height="600" fill="#bae6fd"/>
        <rect x="0" y="420" width="800" height="180" fill="#86efac"/>
        <circle cx="140" cy="110" r="45" fill="#f97316"/>
        <rect x="260" y="260" width="240" height="180" fill="#fef3c7" stroke="#92400e" stroke-width="4"/>
        <polygon points="240,260 380,150 520,260" fill="#ef4444" stroke="#7f1d1d" stroke-width="4"/>
        <rect x="355" y="340" width="50" height="100" fill="#78350f"/>
        <rect x="290" y="300" width="45" height="45" fill="#38bdf8" stroke="#1e3a8a" stroke-width="3"/>
        <rect x="615" y="310" width="30" height="130" fill="#78350f"/>
        <circle cx="630" cy="260" r="70" fill="#22c55e"/>
      </g>
    </svg>
  `);

  const makeSideBySide2 = () => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">
      <g>
        <rect x="0" y="0" width="800" height="600" fill="#1e1b4b"/>
        <circle cx="650" cy="110" r="40" fill="#fef08a"/>
        <polygon points="150,450 220,250 290,450" fill="#94a3b8"/>
        <rect x="195" y="320" width="50" height="130" fill="#f43f5e"/>
        <circle cx="420" cy="220" r="55" fill="#a855f7"/>
        <ellipse cx="420" cy="220" rx="95" ry="18" fill="none" stroke="#fde047" stroke-width="6"/>
      </g>
      <line x1="800" y1="0" x2="800" y2="600" stroke="#ffffff" stroke-width="6"/>
      <g transform="translate(800, 0)">
        <rect x="0" y="0" width="800" height="600" fill="#1e1b4b"/>
        <circle cx="650" cy="110" r="40" fill="#fef08a"/>
        <polygon points="150,450 220,250 290,450" fill="#94a3b8"/>
        <rect x="195" y="320" width="50" height="130" fill="#38bdf8"/>
        <circle cx="420" cy="220" r="55" fill="#a855f7"/>
        <ellipse cx="420" cy="220" rx="95" ry="18" fill="none" stroke="#fde047" stroke-width="6"/>
        <circle cx="300" cy="140" r="10" fill="#ffffff"/>
      </g>
    </svg>
  `);

  gameConfig = {
    title: "大家來找茬連環挑戰賽",
    adminPassword: "1234",
    timerMode: "per-stage",
    globalTimeLimit: 120,
    wrongBehavior: "feedback",
    stages: [
      {
        id: "demo_s1",
        name: "第 1 關：陽光小屋",
        timeLimit: 45,
        maxClicks: 8,
        defaultSpotScore: 10,
        mirrorMode: "auto-half",
        compareImage: makeSideBySide1(),
        spots: [
          { id: "s1_1", x: 0.0875, y: 0.1833, r: 0.035, score: 10 },
          { id: "s1_2", x: 0.2797, y: 0.5375, r: 0.03, score: 15 }
        ]
      },
      {
        id: "demo_s2",
        name: "第 2 關：星空火箭",
        timeLimit: 60,
        maxClicks: 6,
        defaultSpotScore: 20,
        mirrorMode: "auto-half",
        compareImage: makeSideBySide2(),
        spots: [
          { id: "s2_1", x: 0.1375, y: 0.6417, r: 0.032, score: 20 },
          { id: "s2_2", x: 0.1875, y: 0.2333, r: 0.025, score: 25 }
        ]
      }
    ]
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(gameConfig));
  startFullChallenge();
  showToast("已載入單圖左右對比示範（預設後台密碼：1234）！");
}
