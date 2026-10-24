/* ================= Helpers ================= */
const $ = (id) => document.getElementById(id);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function fillList(el, items) {
  el.innerHTML = "";
  (items || []).forEach((item, i) => {
    const li = document.createElement("li");
    li.textContent = item;
    li.style.setProperty("--i", i);
    el.appendChild(li);
  });
}

function listHtml(items) {
  return (items || [])
    .map((t, i) => `<li style="--i:${i}">${esc(t)}</li>`)
    .join("");
}

/* Markdown nyepesi (salama - inaficha HTML kwanza) */
function renderMarkdown(src) {
  const lines = esc(src).split("\n");
  let html = "", inUl = false, inOl = false, inCode = false;
  const closeLists = () => {
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }
  };
  const inline = (t) =>
    t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
     .replace(/`([^`]+)`/g, "<code>$1</code>")
     .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith("```")) {
      closeLists();
      html += inCode ? "</code></pre>" : "<pre><code>";
      inCode = !inCode;
      continue;
    }
    if (inCode) { html += line + "\n"; continue; }

    let m;
    if ((m = line.match(/^\s*#{1,4}\s+(.*)$/))) {
      closeLists(); html += `<h4>${inline(m[1])}</h4>`;
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      if (!inUl) { closeLists(); html += "<ul>"; inUl = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (!inOl) { closeLists(); html += "<ol>"; inOl = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim() === "") {
      closeLists();
    } else {
      closeLists(); html += `<p>${inline(line)}</p>`;
    }
  }
  closeLists();
  if (inCode) html += "</code></pre>";
  return html;
}

/* ================= Tap feedback (ishara kila ukibonyeza) ================= */
function spawnTap(x, y) {
  [false, true].forEach((second) => {
    const ring = document.createElement("div");
    ring.className = "tap-ring" + (second ? " second" : "");
    ring.style.left = x + "px";
    ring.style.top  = y + "px";
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
  });
}

document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("button, a, label, .list-card, .chip, .switch");
  if (!el) return;
  spawnTap(e.clientX, e.clientY);
  el.classList.remove("tapped");
  void el.offsetWidth;
  el.classList.add("tapped");
  setTimeout(() => el.classList.remove("tapped"), 400);
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
}, { passive: true });

/* ================= Auth State ================= */
let currentUser = null;
let currentLang = localStorage.getItem("app_lang") || "";

async function initApp() {
  const token = localStorage.getItem("app_token");
  if (token) {
    try {
      const res = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = {
          id: data.id,
          email: data.email,
          user_metadata: { full_name: data.full_name },
        };
        bootApp();
        return;
      }
    } catch {}
    localStorage.removeItem("app_token");
  }
  currentUser = null;
  bootApp();
}

async function getAuthHeader() {
  const token = localStorage.getItem("app_token");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/* ================= Boot Flow ================= */
function bootApp() {
  if (!currentLang) {
    $("langModal").style.display = "flex";
  } else if (!currentUser) {
    showAuthModal();
  } else {
    onLoggedIn();
  }
}

/* ================= Language ================= */
document.querySelectorAll(".lang-option-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLang = btn.dataset.lang;
    localStorage.setItem("app_lang", currentLang);
    $("langModal").style.display = "none";
    $("userMenuModal").style.display = "none";
    if (!currentUser) showAuthModal();
  });
});

/* ================= Auth Modal ================= */
const authModal      = $("authModal");
const authTitle      = $("authTitle");
const authFullName   = $("authFullName");
const authEmail      = $("authEmail");
const authPassword   = $("authPassword");
const authSubmitBtn  = $("authSubmitBtn");
const authSwitchText = $("authSwitchText");
const authSwitchLink = $("authSwitchLink");
const authError      = $("authError");

let authMode = "login";

function showAuthModal() { authModal.style.display = "flex"; }
function hideAuthModal() { authModal.style.display = "none"; }

authSwitchLink.addEventListener("click", (e) => {
  e.preventDefault();
  authMode = authMode === "login" ? "signup" : "login";
  updateAuthModeUI();
});

function updateAuthModeUI() {
  authError.style.display = "none";
  if (authMode === "login") {
    authTitle.textContent      = "🔐 Ingia";
    authFullName.style.display = "none";
    authSubmitBtn.textContent  = "Ingia";
    authSwitchText.textContent = "Huna akaunti?";
    authSwitchLink.textContent = "Jisajili";
  } else {
    authTitle.textContent      = "📝 Jisajili";
    authFullName.style.display = "block";
    authSubmitBtn.textContent  = "Jisajili";
    authSwitchText.textContent = "Una akaunti tayari?";
    authSwitchLink.textContent = "Ingia";
  }
}

authSubmitBtn.addEventListener("click", async () => {
  authError.style.display = "none";
  const email    = authEmail.value.trim();
  const password = authPassword.value;
  const fullName = authFullName.value.trim();

  if (!email || !password) {
    authError.textContent   = "Jaza email na password";
    authError.style.display = "block";
    return;
  }
  if (authMode === "signup" && !fullName) {
    authError.textContent   = "Jaza jina lako kamili";
    authError.style.display = "block";
    return;
  }

  authSubmitBtn.disabled    = true;
  authSubmitBtn.textContent = "Inasubiri...";

  try {
    const isSignup = authMode === "signup";
    const res = await fetch(isSignup ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isSignup ? { email, password, full_name: fullName } : { email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || (isSignup ? "Usajili umeshindwa" : "Imeshindwa kuingia"));

    localStorage.setItem("app_token", data.token);
    currentUser = {
      id: data.user.id,
      email: data.user.email,
      user_metadata: { full_name: data.user.full_name },
    };
    hideAuthModal();
    onLoggedIn();
  } catch (err) {
    authError.textContent   = "❌ " + (err.message || "Hitilafu imetokea");
    authError.style.display = "block";
  } finally {
    authSubmitBtn.disabled = false;
    updateAuthModeUI();
  }
});

updateAuthModeUI();

/* ================= User Menu / Logout ================= */
const userMenuBtn        = $("userMenuBtn");
const userMenuModal      = $("userMenuModal");
const closeUserMenuBtn   = $("closeUserMenuBtn");
const logoutBtn          = $("logoutBtn");
const logoutConfirmModal = $("logoutConfirmModal");
const confirmLogoutBtn   = $("confirmLogoutBtn");
const cancelLogoutBtn    = $("cancelLogoutBtn");

userMenuBtn.addEventListener("click", () => {
  $("userMenuName").textContent = "👤 " + (currentUser?.user_metadata?.full_name || "Mtumiaji");
  userMenuModal.style.display = "flex";
});
closeUserMenuBtn.addEventListener("click", () => { userMenuModal.style.display = "none"; });

logoutBtn.addEventListener("click", () => {
  userMenuModal.style.display = "none";
  $("logoutEmailDisplay").textContent = currentUser?.email || "";
  logoutConfirmModal.style.display = "flex";
});

confirmLogoutBtn.addEventListener("click", () => {
  localStorage.removeItem("app_token");
  currentUser = null;
  location.reload();
});

cancelLogoutBtn.addEventListener("click", () => { logoutConfirmModal.style.display = "none"; });

/* ================= Profile / Quota / Admin / Chat button ================= */
const adminPanelBtn = $("adminPanelBtn");
const chatFab       = $("chatFab");
const chatPanel     = $("chatPanel");
const chatToggle    = $("chatPublicToggle");

let userIsAdmin = false;

async function loadProfile() {
  try {
    const headers = await getAuthHeader();
    const res = await fetch("/api/profile", { headers });
    if (!res.ok) return null;
    const data = await res.json();

    const bar  = $("quotaBar");
    const text = $("quotaText");
    if (data.is_admin) {
      text.textContent = "👑 Admin - Ratili bila kikomo";
    } else {
      text.textContent = `📊 Umetumia ${data.messages_used_today}/${data.messages_limit + data.bonus_messages} leo`;
    }
    bar.style.display = "block";

    userIsAdmin = !!data.is_admin;
    adminPanelBtn.style.display = userIsAdmin ? "block" : "none";

    /* Kitufe cha AI Chat: admin kila wakati, watumiaji wengine ikiwa admin ameruhusu */
    chatFab.style.display = data.chat_enabled ? "flex" : "none";
    $("chatBadge").textContent = data.chat_public ? "🌍 Inaonekana kwa watumiaji wote" : "🔒 Wewe (admin) pekee";
    chatToggle.checked = !!data.chat_public;
    if (!data.chat_enabled) closeChat();

    return data;
  } catch {
    return null;
  }
}

function refreshQuota() { return loadProfile(); }

async function onLoggedIn() {
  await loadProfile();
  renderHistory();
  renderFavorites();
}

/* ================= Elements: Scan Page ================= */
const form         = $("foodForm");
const cameraInput  = $("cameraInput");
const galleryInput = $("galleryInput");
const cameraBtn    = $("cameraBtn");
const galleryBtn   = $("galleryBtn");
const preview      = $("preview");
const uploadText   = $("uploadText");
const loading      = $("loading");
const loadingText  = $("loadingText");
const result       = $("result");
const errorBox     = $("errorBox");
const submitBtn    = $("submitBtn");
const tryAgainBtn  = $("tryAgainBtn");
const favBtn       = $("favBtn");
const shareBtn     = $("shareBtn");

let currentData     = null;
let currentMethod   = "jiko_kawaida";
let selectedFile    = null;   // picha asili aliyochagua mtumiaji
let compressedBlob  = null;   // picha iliyopunguzwa (ikiwa tayari)
let compressPromise = null;   // inasubiriwa kama bado inaandaliwa

/* Picha ya ukubwa wowote inapunguzwa kwenye simu kabla ya kutumwa (haraka, bila base64) */
function compressImage(file, maxSize = 768, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round((height * maxSize) / width); width = maxSize;
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height); height = maxSize;
      }
      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

/* Picha inatambuliwa MARA MOJA - kuandaa ni nyuma ya pazia */
function handleFileSelected(file) {
  if (!file) return;
  selectedFile   = file;
  compressedBlob = null;
  errorBox.style.display = "none";

  preview.src = URL.createObjectURL(file);
  preview.style.display    = "block";
  uploadText.style.display = "none";

  compressPromise = compressImage(file)
    .then((blob) => { compressedBlob = blob; return blob; })
    .catch(() => { compressedBlob = file; return file; });
}

cameraBtn.addEventListener("click", () => cameraInput.click());
galleryBtn.addEventListener("click", () => galleryInput.click());
cameraInput.addEventListener("change", () => handleFileSelected(cameraInput.files[0]));
galleryInput.addEventListener("change", () => handleFileSelected(galleryInput.files[0]));

const loadingMessages = [
  "🔍 Inatambua chakula...",
  "🧂 Inatafuta viungo...",
  "👩‍🍳 Inaandaa maelekezo marefu...",
  "🔥 Karibu tumemaliza...",
];
let loadingInterval = null;
function startLoadingAnimation() {
  let i = 0;
  loadingText.textContent = loadingMessages[0];
  loadingInterval = setInterval(() => {
    i = (i + 1) % loadingMessages.length;
    loadingText.textContent = loadingMessages[i];
  }, 2000);
}
function stopLoadingAnimation() { clearInterval(loadingInterval); }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedFile) {
    errorBox.textContent   = "❌ Tafadhali chagua au piga picha kwanza";
    errorBox.style.display = "block";
    return;
  }

  result.style.display   = "none";
  errorBox.style.display = "none";
  loading.style.display  = "block";
  submitBtn.disabled     = true;
  startLoadingAnimation();

  try {
    /* Kama picha bado inaandaliwa, subiri kidogo badala ya kukataa */
    const blob = compressedBlob || (await compressPromise) || selectedFile;

    const formData = new FormData();
    formData.append("image", blob, "food.jpg");
    formData.append("lang", currentLang || "sw");

    const headers  = await getAuthHeader();
    const response = await fetch("/api/identify-food", { method: "POST", headers, body: formData });

    if (response.status === 429) {
      stopLoadingAnimation();
      loading.style.display = "none";
      submitBtn.disabled    = false;
      $("quotaExceededModal").style.display = "flex";
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Picha ni kubwa mno au server imeshindwa kujibu. Jaribu tena.");
    }
    const data = await response.json();

    if (response.status === 401) {
      showAuthModal();
      throw new Error("Tafadhali ingia (login) kwanza.");
    }
    if (!response.ok) throw new Error(data.error || "Hitilafu imetokea");
    if (data.is_food === false) {
      throw new Error(data.tips || "Picha hii haionyeshi chakula. Tafadhali piga picha ya chakula halisi.");
    }

    currentData   = data;
    currentMethod = "jiko_kawaida";
    displayResult(data);
    refreshQuota();
    renderHistory();
  } catch (err) {
    errorBox.textContent   = "❌ " + err.message;
    errorBox.style.display = "block";
  } finally {
    stopLoadingAnimation();
    loading.style.display = "none";
    submitBtn.disabled    = false;
  }
});

function displayResult(data) {
  $("foodName").textContent   = data.food_name || "Haijulikani";
  $("origin").textContent     = data.origin ? `Asili: ${data.origin}` : "";
  $("confidence").textContent = `Uhakika: ${data.confidence || "-"}`;
  $("tips").textContent       = data.tips || "-";

  fillList($("ingredientsList"), data.ingredients);

  const n = data.nutrition || {};
  $("nutCalories").textContent   = n.calories || "-";
  $("nutProtein").textContent    = n.protein || "-";
  $("nutCarbs").textContent      = n.carbs || "-";
  $("nutFat").textContent        = n.fat || "-";
  $("nutritionNote").textContent = n.nutrition_note || "";

  checkIfFavorited(data.food_name);
  renderMethod(currentMethod);
  result.style.display = "block";
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMethod(methodKey) {
  if (!currentData || !currentData.cooking_methods) return;
  const method = currentData.cooking_methods[methodKey];
  document.querySelectorAll(".tab-btn").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.method === methodKey)
  );

  const stepsList         = $("stepsList");
  const methodDescription = $("methodDescription");
  const cookingTime       = $("cookingTime");

  if (!method) {
    methodDescription.textContent = "Njia hii haihitajiki kwa chakula hiki.";
    stepsList.innerHTML = "";
    cookingTime.textContent = "-";
    return;
  }
  methodDescription.textContent = method.description || "";
  cookingTime.textContent       = method.cooking_time || "-";
  fillList(stepsList, method.steps);
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (btn) {
    currentMethod = btn.dataset.method;
    renderMethod(currentMethod);
  }
});

/* ================= Favorites ================= */
let favoritesCache = [];

async function loadFavoritesCache() {
  const headers = await getAuthHeader();
  const res     = await fetch("/api/favorites", { headers });
  favoritesCache = res.ok ? await res.json() : [];
  return favoritesCache;
}

function checkIfFavorited(foodName) {
  const isFav = favoritesCache.some((f) => f.food_name === foodName);
  favBtn.textContent = isFav ? "★" : "☆";
  favBtn.classList.toggle("active", isFav);
}

favBtn.addEventListener("click", async () => {
  if (!currentData) return;
  const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
  const isFav   = favoritesCache.some((f) => f.food_name === currentData.food_name);

  if (isFav) {
    await fetch(`/api/favorites?food_name=${encodeURIComponent(currentData.food_name)}`, {
      method: "DELETE",
      headers,
    });
  } else {
    await fetch("/api/favorites", {
      method: "POST",
      headers,
      body: JSON.stringify({ food_name: currentData.food_name, data: currentData }),
    });
  }
  await loadFavoritesCache();
  checkIfFavorited(currentData.food_name);
  renderFavorites();
});

/* ================= Share ================= */
shareBtn.addEventListener("click", () => {
  if (!currentData) return;
  const method = currentData.cooking_methods?.[currentMethod];
  let text = `🍲 *${currentData.food_name}*\n\n`;
  text += `🧂 *Ingredients:*\n${(currentData.ingredients || []).map((i) => "- " + i).join("\n")}\n\n`;
  if (method) {
    text += `👩‍🍳 *Jinsi ya Kupika:*\n`;
    text += (method.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n");
  }
  text += `\n\nTambua Chakula app - world-food-scanner.vercel.app`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
});

tryAgainBtn.addEventListener("click", () => {
  form.reset();
  preview.style.display    = "none";
  uploadText.style.display = "block";
  result.style.display     = "none";
  currentData     = null;
  selectedFile    = null;
  compressedBlob  = null;
  compressPromise = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ================= Page Tabs ================= */
const pageTabs = document.querySelectorAll(".page-tab-btn");
const pages = {
  scan:      $("scanPage"),
  pro:       $("proPage"),
  history:   $("historyPage"),
  favorites: $("favoritesPage"),
};

function showPage(key) {
  pageTabs.forEach((b) => b.classList.toggle("active", b.dataset.page === key));
  Object.entries(pages).forEach(([k, el]) => {
    el.style.display = k === key ? "block" : "none";
    if (k === key) {
      el.classList.remove("page-in");
      void el.offsetWidth;
      el.classList.add("page-in");
    }
  });
  if (key === "history")   renderHistory();
  if (key === "favorites") renderFavorites();
}

pageTabs.forEach((btn) => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

/* ================= History / Favorites Rendering ================= */
function renderCard(entry, container, index) {
  const card = document.createElement("div");
  card.className = "list-card";
  card.style.setProperty("--i", index);
  card.innerHTML = `<strong>${esc(entry.food_name)}</strong><span class="list-card-origin">${esc(entry.data?.origin || "")}</span>`;
  card.addEventListener("click", () => openViewModal(entry.data));
  container.appendChild(card);
}

async function renderHistory() {
  const headers   = await getAuthHeader();
  const res       = await fetch("/api/history", { headers });
  const list      = res.ok ? await res.json() : [];
  const container = $("historyList");
  const emptyMsg  = $("historyEmpty");
  container.innerHTML = "";
  if (list.length === 0) { emptyMsg.style.display = "block"; return; }
  emptyMsg.style.display = "none";
  list.forEach((entry, i) => renderCard(entry, container, i));
}

async function renderFavorites() {
  const list      = await loadFavoritesCache();
  const container = $("favoritesList");
  const emptyMsg  = $("favoritesEmpty");
  container.innerHTML = "";
  if (list.length === 0) { emptyMsg.style.display = "block"; return; }
  emptyMsg.style.display = "none";
  list.forEach((entry, i) => renderCard(entry, container, i));
}

/* ================= View Modal ================= */
const viewModal   = $("viewModal");
const viewContent = $("viewContent");
$("closeViewBtn").addEventListener("click", () => { viewModal.style.display = "none"; });
viewModal.addEventListener("click", (e) => {
  if (e.target === viewModal) viewModal.style.display = "none";
});

function openViewModal(entry) {
  entry = entry || {};
  const n  = entry.nutrition || {};
  const m1 = entry.cooking_methods?.jiko_kawaida;
  const m2 = entry.cooking_methods?.njia_ya_kisasa;

  let html = `
    <h2>${esc(entry.food_name)}</h2>
    <p class="origin">Asili: ${esc(entry.origin || "-")}</p>
    <h3>🧂 Viungo</h3>
    <ul>${listHtml(entry.ingredients)}</ul>
    <h3>🔥 Lishe</h3>
    <p>Calories: ${esc(n.calories || "-")} | Protini: ${esc(n.protein || "-")} | Wanga: ${esc(n.carbs || "-")} | Mafuta: ${esc(n.fat || "-")}</p>
    <h3>👩‍🍳 Jiko la Kawaida</h3>
    <p class="method-desc">${esc(m1?.description || "")}</p>
    <ol>${listHtml(m1?.steps)}</ol>
    <p class="time-pill">⏱ Muda: ${esc(m1?.cooking_time || "-")}</p>`;

  if (m2 && (m2.steps || []).length) {
    html += `
    <h3>⚡ Njia ya Kisasa</h3>
    <p class="method-desc">${esc(m2.description || "")}</p>
    <ol>${listHtml(m2.steps)}</ol>
    <p class="time-pill">⏱ Muda: ${esc(m2.cooking_time || "-")}</p>`;
  }

  html += `<p class="tips"><strong>💡 Ushauri:</strong> ${esc(entry.tips || "-")}</p>`;
  viewContent.innerHTML = html;
  viewModal.style.display = "flex";
}

/* ================= Pro Page (viungo AU chakula unachotaka) ================= */
let proMode = "ingredients";

const PRO_TEXTS = {
  ingredients: {
    hint: "Andika viungo ulivyonavyo nyumbani, tutakupendekezea vyakula unavyoweza kupika pamoja na jinsi ya kuvitengeneza.",
    placeholder: "Mfano: unga wa ngano, mafuta, sukari, mayai...",
  },
  dish: {
    hint: "Elezea chakula unachotaka kupika (jina, idadi ya watu, ladha unayopenda, unachotaka kuepuka) na tutakupa mapishi kamili.",
    placeholder: "Mfano: Nataka kupika pilau ya kuku kwa watu 4, isiwe na pilipili nyingi...",
  },
};

document.querySelectorAll("#proModeChips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    proMode = chip.dataset.mode;
    document.querySelectorAll("#proModeChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
    $("proHint").textContent = PRO_TEXTS[proMode].hint;
    $("proIngredients").placeholder = PRO_TEXTS[proMode].placeholder;
  });
});

$("proSubmitBtn").addEventListener("click", async () => {
  const ingredients = $("proIngredients").value.trim();
  const proError    = $("proError");
  const proResults  = $("proResults");
  const proLoading  = $("proLoading");
  const proBtn      = $("proSubmitBtn");

  proError.style.display = "none";
  proResults.innerHTML   = "";

  if (!ingredients) {
    proError.textContent   = proMode === "dish"
      ? "❌ Andika chakula unachotaka kupika"
      : "❌ Andika angalau kiungo kimoja";
    proError.style.display = "block";
    return;
  }

  proLoading.style.display = "block";
  proBtn.disabled = true;
  try {
    const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
    const res     = await fetch("/api/pro-suggest", {
      method: "POST",
      headers,
      body: JSON.stringify({ ingredients, mode: proMode, lang: currentLang || "sw" }),
    });

    if (res.status === 429) {
      proLoading.style.display = "none";
      $("quotaExceededModal").style.display = "flex";
      return;
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("Server imeshindwa kujibu. Jaribu tena.");
    const data = await res.json();
    if (res.status === 401) { showAuthModal(); throw new Error("Tafadhali ingia kwanza."); }
    if (!res.ok) throw new Error(data.error || "Hitilafu imetokea");

    if (data.is_valid === false) {
      throw new Error(data.message || "Tafadhali andika viungo au chakula halisi.");
    }
    if ((data.suggestions || []).length === 0) {
      proError.textContent   = "Hakuna mapendekezo yaliyopatikana. Jaribu kuandika tofauti.";
      proError.style.display = "block";
      return;
    }

    data.suggestions.forEach((s, idx) => {
      const card = document.createElement("div");
      card.className = "pro-card";
      card.style.setProperty("--i", idx);

      const ings  = (s.ingredients_list || []);
      const extra = (s.extra_needed || []);

      card.innerHTML = `
        <div class="pro-card-head"><span class="pro-num">${idx + 1}</span><strong>${esc(s.food_name)}</strong></div>
        <p class="pro-desc">${esc(s.short_description)}</p>
        ${ings.length ? `<h4>🧂 Viungo Vinavyohitajika</h4><ul class="bullets">${listHtml(ings)}</ul>` : ""}
        <p class="pro-extra"><em>🛒 Vya ziada unavyoweza kuhitaji: ${esc(extra.join(", ") || "hakuna")}</em></p>
        <h4>👩‍🍳 Jinsi ya Kutengeneza</h4>
        <ol class="steps">${listHtml(s.steps)}</ol>
        ${s.cooking_time ? `<p class="time-pill">⏱ Muda: ${esc(s.cooking_time)}</p>` : ""}
        ${s.tips ? `<p class="tips"><strong>💡 Ushauri:</strong> ${esc(s.tips)}</p>` : ""}
      `;
      proResults.appendChild(card);
    });
    refreshQuota();
  } catch (err) {
    proError.textContent   = "❌ " + err.message;
    proError.style.display = "block";
  } finally {
    proLoading.style.display = "none";
    proBtn.disabled = false;
  }
});

/* ================= AI Chat (kitufe cha duara + skrini nzima) ================= */
const chatMessages = $("chatMessages");
const chatInput    = $("chatInput");
const chatSendBtn  = $("chatSendBtn");

let chatHistory = [];
let chatBusy    = false;

function scrollChat() { chatMessages.scrollTop = chatMessages.scrollHeight; }

function openChat() {
  chatPanel.style.display = "flex";
  document.body.style.overflow = "hidden";
  if (chatMessages.children.length === 0) chatWelcome();
  scrollChat();
}

function closeChat() {
  chatPanel.style.display = "none";
  document.body.style.overflow = "";
}

chatFab.addEventListener("click", openChat);
$("chatCloseBtn").addEventListener("click", closeChat);

function chatWelcome() {
  chatMessages.innerHTML = `
    <div class="chat-welcome">
      <span class="big">🤖</span>
      <h4>Habari! Mimi ni Tambua Chakula AI</h4>
      <p>Niulize swali lolote - upishi, lishe, elimu, biashara, teknolojia na mengineyo.</p>
      <div class="chip-row">
        <button type="button" class="chip" data-q="Nipe mapishi kamili ya pilau ya nyama kwa watu 5">🍛 Pilau ya nyama</button>
        <button type="button" class="chip" data-q="Nieleze faida za kula mboga za majani kila siku">🥬 Faida za mboga</button>
        <button type="button" class="chip" data-q="Nipe mawazo 5 ya biashara ndogo ya chakula">💡 Biashara ya chakula</button>
      </div>
    </div>`;
}

function addBubble(kind, html) {
  const div = document.createElement("div");
  div.className = "msg " + kind;
  div.innerHTML = html;
  chatMessages.appendChild(div);
  scrollChat();
  return div;
}

function addTyping() {
  const div = document.createElement("div");
  div.className = "typing";
  div.innerHTML = "<i></i><i></i><i></i>";
  chatMessages.appendChild(div);
  scrollChat();
  return div;
}

/* Jibu linaandikwa taratibu kama mashine ya kuandika */
function typeInto(el, text, done) {
  const step = Math.max(6, Math.ceil(text.length / 90));
  let i = 0;
  const timer = setInterval(() => {
    i = Math.min(text.length, i + step);
    el.innerHTML = renderMarkdown(text.slice(0, i));
    scrollChat();
    if (i >= text.length) {
      clearInterval(timer);
      if (done) done();
    }
  }, 30);
}

function autoGrow() {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + "px";
}

async function sendChat(text) {
  text = (text || "").trim();
  if (!text || chatBusy) return;

  chatBusy = true;
  chatSendBtn.disabled = true;
  if (chatHistory.length === 0) chatMessages.innerHTML = "";

  chatHistory.push({ role: "user", text });
  addBubble("user", esc(text).replace(/\n/g, "<br>"));
  chatInput.value = "";
  autoGrow();
  const typing = addTyping();

  try {
    const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
    const res = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: chatHistory, lang: currentLang || "sw" }),
    });

    if (res.status === 429) {
      typing.remove();
      chatHistory.pop();
      $("quotaExceededModal").style.display = "flex";
      return;
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("Server imeshindwa kujibu. Jaribu tena.");
    const data = await res.json();

    if (res.status === 401) { showAuthModal(); throw new Error("Tafadhali ingia kwanza."); }
    if (res.status === 403) {
      chatFab.style.display = "none";
      closeChat();
      throw new Error(data.error || "Huna ruhusa ya kutumia AI Chat.");
    }
    if (!res.ok) throw new Error(data.error || "Hitilafu imetokea");

    typing.remove();
    chatHistory.push({ role: "model", text: data.reply });
    const bubble = addBubble("bot", "");
    typeInto(bubble, data.reply);
    refreshQuota();
  } catch (err) {
    typing.remove();
    chatHistory.pop();
    addBubble("bot err", "❌ " + esc(err.message));
  } finally {
    chatBusy = false;
    chatSendBtn.disabled = false;
  }
}

chatSendBtn.addEventListener("click", () => sendChat(chatInput.value));
chatInput.addEventListener("input", autoGrow);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat(chatInput.value);
  }
});

chatMessages.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip[data-q]");
  if (chip) sendChat(chip.dataset.q);
});

$("chatClearBtn").addEventListener("click", () => {
  if (chatBusy) return;
  chatHistory = [];
  chatWelcome();
});

/* ================= Admin helper ================= */
async function adminPost(path, body) {
  const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
  return res.ok;
}

/* Kitufe cha admin (ndani ya Admin Panel pekee): ruhusu AI Chat kwa watu wote */
chatToggle.addEventListener("change", async () => {
  const checked = chatToggle.checked;
  const ok = await adminPost("/api/admin/settings", { chat_public: checked });
  if (ok) {
    $("chatBadge").textContent = checked ? "🌍 Inaonekana kwa watumiaji wote" : "🔒 Wewe (admin) pekee";
    toast(checked ? "✅ AI Chat sasa inaonekana kwa watu WOTE" : "🔒 AI Chat sasa ni yako (admin) pekee");
  } else {
    chatToggle.checked = !checked;
    toast("❌ Imeshindwa kubadilisha");
  }
});

/* ================= About Modal ================= */
const aboutBtn      = $("aboutBtn");
const closeAboutBtn = $("closeAboutBtn");
const aboutModal    = $("aboutModal");
aboutBtn.addEventListener("click", () => { aboutModal.style.display = "flex"; });
closeAboutBtn.addEventListener("click", () => { aboutModal.style.display = "none"; });
aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) aboutModal.style.display = "none";
});

/* ================= Quota Exceeded / Referral ================= */
const SHARE_URL  = "https://world-food-scanner.vercel.app";
const SHARE_TEXT = "Jaribu app hii ya kutambua chakula chochote duniani kwa picha tu! 🍲";

$("shareWhatsappBtn").addEventListener("click", async () => {
  window.open(`https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + " " + SHARE_URL)}`, "_blank");
  await claimReferralBonus();
});

$("shareTelegramBtn").addEventListener("click", async () => {
  window.open(`https://t.me/share/url?url=${encodeURIComponent(SHARE_URL)}&text=${encodeURIComponent(SHARE_TEXT)}`, "_blank");
  await claimReferralBonus();
});

$("copyLinkBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    $("referralStatus").textContent   = "✅ Link imenakiliwa! Tuma kwa marafiki 2+";
    $("referralStatus").style.display = "block";
  } catch {}
});

$("closeQuotaModalBtn").addEventListener("click", () => {
  $("quotaExceededModal").style.display = "none";
});

async function claimReferralBonus() {
  try {
    const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
    const res     = await fetch("/api/claim-referral-bonus", { method: "POST", headers });
    if (!res.ok) return;
    const data     = await res.json();
    const statusEl = $("referralStatus");
    statusEl.textContent   = `✅ Umepata messages za ziada! Bonus jumla: ${data.bonus_messages}`;
    statusEl.style.display = "block";
    refreshQuota();
  } catch {}
}

/* ================= Admin Panel ================= */
const adminModal    = $("adminModal");
const closeAdminBtn = $("closeAdminBtn");

adminPanelBtn.addEventListener("click", () => {
  userMenuModal.style.display = "none";
  adminModal.style.display    = "flex";
  loadAdminSettings();
  loadAdminUsers();
});
closeAdminBtn.addEventListener("click", () => { adminModal.style.display = "none"; });

document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    $("adminSettingsTab").style.display = btn.dataset.atab === "settings" ? "block" : "none";
    $("adminUsersTab").style.display    = btn.dataset.atab === "users" ? "block" : "none";
    $("adminAiTab").style.display       = btn.dataset.atab === "ai" ? "block" : "none";
    if (btn.dataset.atab === "users") loadAdminUsers();
    if (btn.dataset.atab === "ai")    loadAiKnowledge();
  });
});

async function loadAdminSettings() {
  const headers = await getAuthHeader();
  const res     = await fetch("/api/admin/settings", { headers });
  if (!res.ok) return;
  const data = await res.json();
  $("currentGeminiKey").textContent = data.gemini_api_key_masked || "-";
  $("defaultLimitInput").value      = data.default_message_limit || 5;
  $("referralBonusInput").value     = data.referral_bonus_messages || 5;
  chatToggle.checked = !!data.chat_public;
}

$("saveGeminiKeyBtn").addEventListener("click", async () => {
  const key = $("newGeminiKey").value.trim();
  if (!key) return;
  const ok = await adminPost("/api/admin/settings", { gemini_api_key: key });
  $("newGeminiKey").value = "";
  toast(ok ? "✅ Gemini API key imesasishwa" : "❌ Imeshindwa kuhifadhi");
  loadAdminSettings();
});

$("clearGeminiKeyBtn").addEventListener("click", async () => {
  const ok = await adminPost("/api/admin/settings/clear-gemini-key");
  toast(ok ? "✅ Imefutwa, sasa inatumia Environment Variable" : "❌ Imeshindwa");
  loadAdminSettings();
});

$("saveDefaultLimitBtn").addEventListener("click", async () => {
  const val = $("defaultLimitInput").value;
  const ok  = await adminPost("/api/admin/settings", { default_message_limit: val, apply_to_all: false });
  toast(ok ? "✅ Limit mpya itatumika kwa watumiaji WAPYA tu" : "❌ Imeshindwa");
});

$("saveDefaultLimitAllBtn").addEventListener("click", async () => {
  const val = $("defaultLimitInput").value;
  if (!confirm(`Una uhakika unataka kubadilisha limit ya WATUMIAJI WOTE kuwa ${val}?`)) return;
  const ok = await adminPost("/api/admin/settings", { default_message_limit: val, apply_to_all: true });
  toast(ok ? "✅ Limit imesasishwa kwa WATUMIAJI WOTE" : "❌ Imeshindwa");
  loadAdminUsers();
});

$("saveReferralBonusBtn").addEventListener("click", async () => {
  const val = $("referralBonusInput").value;
  const ok  = await adminPost("/api/admin/settings", { referral_bonus_messages: val });
  toast(ok ? "✅ Referral bonus imesasishwa" : "❌ Imeshindwa");
});

/* ----- Admin: watumiaji ----- */
let adminUsersCache = [];

function renderAdminStats(users) {
  const used = users.reduce((s, u) => s + (u.messages_used_today || 0), 0);
  const refs = users.reduce((s, u) => s + (u.referral_count || 0), 0);
  $("adminStats").innerHTML = `
    <div class="stat-card"><b>${users.length}</b><small>Watumiaji</small></div>
    <div class="stat-card"><b>${used}</b><small>Matumizi leo</small></div>
    <div class="stat-card"><b>${refs}</b><small>Referrals</small></div>`;
}

function renderAdminUsers() {
  const container = $("adminUsersList");
  const q = ($("adminSearch").value || "").trim().toLowerCase();
  const users = adminUsersCache.filter((u) =>
    !q || (u.full_name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
  );

  container.innerHTML = "";
  if (users.length === 0) {
    container.innerHTML = "<p class='empty-msg'>Hakuna watumiaji</p>";
    return;
  }

  users.forEach((u, i) => {
    const total   = (u.messages_limit || 0) + (u.bonus_messages || 0);
    const pct     = total ? Math.min(100, Math.round(((u.messages_used_today || 0) / total) * 100)) : 0;
    const initial = esc((u.full_name || u.email || "?").trim().charAt(0).toUpperCase());

    const card = document.createElement("div");
    card.className = "admin-user-card";
    card.style.setProperty("--i", i);
    card.innerHTML = `
      <div class="user-top">
        <div class="avatar">${initial}</div>
        <div>
          <strong>${esc(u.full_name || "Mtumiaji")}</strong>
          <span class="admin-user-info">${esc(u.email || "")}</span>
        </div>
      </div>
      <div class="usage-bar"><i style="width:${pct}%"></i></div>
      <span class="admin-user-info">Ametumia: ${u.messages_used_today || 0}/${total} leo &middot; Referrals: ${u.referral_count || 0}</span>
      <div class="admin-user-actions">
        <input type="number" class="admin-limit-input" value="${u.messages_limit}" data-id="${esc(u.id)}">
        <button type="button" class="admin-mini-btn admin-set-limit-btn" data-id="${esc(u.id)}">Weka</button>
        <button type="button" class="admin-mini-btn admin-delete-btn" data-id="${esc(u.id)}">Futa</button>
      </div>`;
    container.appendChild(card);
  });
}

async function loadAdminUsers() {
  const headers   = await getAuthHeader();
  const res       = await fetch("/api/admin/users", { headers });
  const container = $("adminUsersList");
  if (!res.ok) { container.innerHTML = "<p class='empty-msg'>Imeshindwa kupata watumiaji</p>"; return; }
  adminUsersCache = await res.json();
  renderAdminStats(adminUsersCache);
  renderAdminUsers();
}

$("adminSearch").addEventListener("input", renderAdminUsers);

$("adminUsersList").addEventListener("click", async (e) => {
  const setBtn = e.target.closest(".admin-set-limit-btn");
  const delBtn = e.target.closest(".admin-delete-btn");

  if (setBtn) {
    const id    = setBtn.dataset.id;
    const input = document.querySelector(`.admin-limit-input[data-id="${CSS.escape(id)}"]`);
    const ok    = await adminPost(`/api/admin/users/${id}/limit`, { messages_limit: input.value });
    toast(ok ? "✅ Limit imebadilishwa" : "❌ Imeshindwa");
  }

  if (delBtn) {
    if (!confirm("Una uhakika unataka kufuta mtumiaji huyu kabisa?")) return;
    const headers = await getAuthHeader();
    await fetch(`/api/admin/users/${delBtn.dataset.id}`, { method: "DELETE", headers });
    toast("🗑 Mtumiaji amefutwa");
    loadAdminUsers();
  }
});

/* ================= Admin: Kumbukumbu za AI (tab ya 🧠 AI) ================= */
let aiItemType = "fact";

const AI_PLACEHOLDERS = {
  fact: "Mfano: Braiton alizaliwa tarehe ... mwaka ... Kilimanjaro. Alianza kutengeneza app mwaka ...",
  rule: "Mfano: Mtu akiuliza \"huyu admin ni nani?\" mjibu kwa ufupi kwanza, kisha muulize kama anataka kujua zaidi.",
};

document.querySelectorAll("#aiTypeChips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    aiItemType = chip.dataset.type;
    document.querySelectorAll("#aiTypeChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
    $("aiItemInput").placeholder = AI_PLACEHOLDERS[aiItemType];
  });
});

function renderAiItems(items) {
  const list = $("aiItemsList");
  $("aiItemCount").textContent = items.length;
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = "<p class='empty-msg'>Bado hujamfundisha AI kitu chochote kipya.</p>";
    return;
  }

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "ai-item";
    row.innerHTML = `
      <span class="ai-badge ${it.type === "rule" ? "rule" : "fact"}">${it.type === "rule" ? "📜 Sheria" : "🧠 Taarifa"}</span>
      <p>${esc(it.text)}</p>
      <button type="button" class="admin-mini-btn admin-delete-btn ai-del-btn" data-id="${esc(it.id)}">Futa</button>`;
    list.appendChild(row);
  });
}

async function loadAiKnowledge() {
  const headers = await getAuthHeader();
  const res = await fetch("/api/admin/ai-knowledge", { headers });
  if (!res.ok) { toast("❌ Imeshindwa kupakia kumbukumbu za AI"); return; }
  const data = await res.json();
  $("aiBioInput").value = data.bio || "";
  renderAiItems(data.items || []);
}

$("saveAiBioBtn").addEventListener("click", async () => {
  const bio = $("aiBioInput").value.trim();
  const ok  = await adminPost("/api/admin/ai-knowledge/bio", { bio });
  toast(ok ? "✅ Maelezo yamehifadhiwa, AI inakujua zaidi sasa" : "❌ Imeshindwa kuhifadhi");
  if (ok) loadAiKnowledge();
});

$("resetAiBioBtn").addEventListener("click", async () => {
  if (!confirm("Rudisha maelezo ya awali? Mabadiliko uliyoandika kwenye kisanduku hiki yatafutwa.")) return;
  const ok = await adminPost("/api/admin/ai-knowledge/bio", { bio: "" });
  toast(ok ? "✅ Yamerudishwa ya awali" : "❌ Imeshindwa");
  if (ok) loadAiKnowledge();
});

$("addAiItemBtn").addEventListener("click", async () => {
  const text = $("aiItemInput").value.trim();
  if (!text) { toast("✍️ Andika kitu cha kumfundisha AI kwanza"); return; }

  const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
  const res = await fetch("/api/admin/ai-knowledge/items", {
    method: "POST",
    headers,
    body: JSON.stringify({ type: aiItemType, text }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) { toast("❌ " + (data.error || "Imeshindwa kuongeza")); return; }
  $("aiItemInput").value = "";
  renderAiItems(data.items || []);
  toast("✅ AI imekumbuka");
});

$("aiItemsList").addEventListener("click", async (e) => {
  const btn = e.target.closest(".ai-del-btn");
  if (!btn) return;
  if (!confirm("Futa kumbukumbu hii?")) return;

  const headers = await getAuthHeader();
  const res = await fetch(`/api/admin/ai-knowledge/items/${encodeURIComponent(btn.dataset.id)}`, {
    method: "DELETE",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    renderAiItems(data.items || []);
    toast("🗑 Imefutwa");
  } else {
    toast("❌ Imeshindwa kufuta");
  }
});

/* ================= PWA Service Worker ================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/* ================= Start ================= */
initApp();