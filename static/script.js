/* ================= Supabase Init ================= */
let sb = null;
let currentUser = null;
let currentSession = null;
let currentLang = localStorage.getItem("app_lang") || "";

async function initSupabase() {
  const res = await fetch("/api/config");
  const cfg = await res.json();
  sb = supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key);

  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;
  currentUser = session ? session.user : null;

  sb.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    currentUser = session ? session.user : null;
    if (session) {
      hideAuthModal();
      onLoggedIn();
    }
  });

  bootApp();
}

async function getAuthHeader() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/* ================= Boot Flow ================= */
function bootApp() {
  if (!currentLang) {
    document.getElementById("langModal").style.display = "flex";
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
    document.getElementById("langModal").style.display = "none";
    document.getElementById("userMenuModal").style.display = "none";
    if (!currentUser) {
      showAuthModal();
    }
  });
});

/* ================= Auth Modal ================= */
const authModal = document.getElementById("authModal");
const authTitle = document.getElementById("authTitle");
const authFullName = document.getElementById("authFullName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authSwitchText = document.getElementById("authSwitchText");
const authSwitchLink = document.getElementById("authSwitchLink");
const authError = document.getElementById("authError");

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
    authTitle.textContent = "🔐 Ingia";
    authFullName.style.display = "none";
    authSubmitBtn.textContent = "Ingia";
    authSwitchText.textContent = "Huna akaunti?";
    authSwitchLink.textContent = "Jisajili";
  } else {
    authTitle.textContent = "📝 Jisajili";
    authFullName.style.display = "block";
    authSubmitBtn.textContent = "Jisajili";
    authSwitchText.textContent = "Una akaunti tayari?";
    authSwitchLink.textContent = "Ingia";
  }
}

authSubmitBtn.addEventListener("click", async () => {
  authError.style.display = "none";
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const fullName = authFullName.value.trim();

  if (!email || !password) {
    authError.textContent = "Jaza email na password";
    authError.style.display = "block";
    return;
  }
  if (authMode === "signup" && !fullName) {
    authError.textContent = "Jaza jina lako kamili";
    authError.style.display = "block";
    return;
  }

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "Inasubiri...";

  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw error;
      if (!data.session) {
        authError.textContent = "Signup imefanikiwa, tafadhali ingia (login).";
        authError.style.display = "block";
        authMode = "login";
        updateAuthModeUI();
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    authError.textContent = "❌ " + (err.message || "Hitilafu imetokea");
    authError.style.display = "block";
  } finally {
    authSubmitBtn.disabled = false;
    updateAuthModeUI();
  }
});

updateAuthModeUI();

/* ================= User Menu / Logout ================= */
const userMenuBtn = document.getElementById("userMenuBtn");
const userMenuModal = document.getElementById("userMenuModal");
const closeUserMenuBtn = document.getElementById("closeUserMenuBtn");
const logoutBtn = document.getElementById("logoutBtn");

userMenuBtn.addEventListener("click", () => {
  document.getElementById("userMenuName").textContent =
    "👤 " + (currentUser?.user_metadata?.full_name || "Mtumiaji");
  userMenuModal.style.display = "flex";
});
closeUserMenuBtn.addEventListener("click", () => { userMenuModal.style.display = "none"; });
logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

/* ================= After Login ================= */
async function onLoggedIn() {
  await refreshQuota();
  await checkAdminStatus();
  renderHistory();
  renderFavorites();
}

async function refreshQuota() {
  try {
    const headers = await getAuthHeader();
    const res = await fetch("/api/profile", { headers });
    if (!res.ok) return;
    const data = await res.json();
    const bar = document.getElementById("quotaBar");
    const text = document.getElementById("quotaText");
    text.textContent = `📊 Umetumia ${data.messages_used_today}/${data.messages_limit + data.bonus_messages} leo`;
    bar.style.display = "block";
  } catch {}
}

/* ================= Elements: Scan Page ================= */
const form = document.getElementById("foodForm");
const cameraInput = document.getElementById("cameraInput");
const galleryInput = document.getElementById("galleryInput");
const cameraBtn = document.getElementById("cameraBtn");
const galleryBtn = document.getElementById("galleryBtn");
const preview = document.getElementById("preview");
const uploadText = document.getElementById("uploadText");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loadingText");
const result = document.getElementById("result");
const errorBox = document.getElementById("errorBox");
const submitBtn = document.getElementById("submitBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");
const favBtn = document.getElementById("favBtn");
const shareBtn = document.getElementById("shareBtn");

let currentData = null;
let currentMethod = "jiko_kawaida";
let compressedBlob = null;
let hasImage = false;

function compressImage(file, maxSize = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round((height * maxSize) / width); width = maxSize;
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height); height = maxSize;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Compression failed")), "image/jpeg", quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFileSelected(file) {
  if (!file) return;
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
  uploadText.style.display = "none";
  hasImage = true;
  try { compressedBlob = await compressImage(file); } catch { compressedBlob = file; }
}

cameraBtn.addEventListener("click", () => cameraInput.click());
galleryBtn.addEventListener("click", () => galleryInput.click());
cameraInput.addEventListener("change", () => handleFileSelected(cameraInput.files[0]));
galleryInput.addEventListener("change", () => handleFileSelected(galleryInput.files[0]));

const loadingMessages = ["🔍 Inatambua chakula...", "🧂 Inatafuta viungo...", "👩‍🍳 Inaandaa maelekezo...", "🔥 Karibu tumemaliza..."];
let loadingInterval = null;
function startLoadingAnimation() {
  let i = 0;
  loadingText.textContent = loadingMessages[0];
  loadingInterval = setInterval(() => { i = (i + 1) % loadingMessages.length; loadingText.textContent = loadingMessages[i]; }, 2000);
}
function stopLoadingAnimation() { clearInterval(loadingInterval); }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!hasImage || !compressedBlob) {
    errorBox.textContent = "❌ Tafadhali chagua au piga picha kwanza";
    errorBox.style.display = "block";
    return;
  }

  result.style.display = "none";
  errorBox.style.display = "none";
  loading.style.display = "block";
  submitBtn.disabled = true;
  startLoadingAnimation();

  const formData = new FormData();
  formData.append("image", compressedBlob, "food.jpg");
  formData.append("lang", currentLang || "sw");

  try {
    const headers = await getAuthHeader();
    const response = await fetch("/api/identify-food", { method: "POST", headers, body: formData });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Picha ni kubwa mno au server imeshindwa kujibu. Jaribu tena.");
    }
    const data = await response.json();

    if (response.status === 401) {
      showAuthModal();
      throw new Error("Tafadhali ingia (login) kwanza.");
    }
    if (response.status === 429) {
      throw new Error(`${data.message}\n\nShare: ${data.share_url}`);
    }
    if (!response.ok) {
      throw new Error(data.error || "Hitilafu imetokea");
    }

    currentData = data;
    currentMethod = "jiko_kawaida";
    displayResult(data);
    refreshQuota();
    renderHistory();
  } catch (err) {
    errorBox.textContent = "❌ " + err.message;
    errorBox.style.display = "block";
  } finally {
    stopLoadingAnimation();
    loading.style.display = "none";
    submitBtn.disabled = false;
  }
});

function displayResult(data) {
  document.getElementById("foodName").textContent = data.food_name || "Haijulikani";
  document.getElementById("origin").textContent = data.origin ? `Asili: ${data.origin}` : "";
  document.getElementById("confidence").textContent = `Uhakika: ${data.confidence || "-"}`;
  document.getElementById("tips").textContent = data.tips || "-";

  const ingredientsList = document.getElementById("ingredientsList");
  ingredientsList.innerHTML = "";
  (data.ingredients || []).forEach((item) => {
    const li = document.createElement("li"); li.textContent = item; ingredientsList.appendChild(li);
  });

  const nutrition = data.nutrition || {};
  document.getElementById("nutCalories").textContent = nutrition.calories || "-";
  document.getElementById("nutProtein").textContent = nutrition.protein || "-";
  document.getElementById("nutCarbs").textContent = nutrition.carbs || "-";
  document.getElementById("nutFat").textContent = nutrition.fat || "-";
  document.getElementById("nutritionNote").textContent = nutrition.nutrition_note || "";

  checkIfFavorited(data.food_name);
  renderMethod(currentMethod);
  result.style.display = "block";
}

function renderMethod(methodKey) {
  if (!currentData || !currentData.cooking_methods) return;
  const method = currentData.cooking_methods[methodKey];
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.method === methodKey));

  const stepsList = document.getElementById("stepsList");
  const methodDescription = document.getElementById("methodDescription");
  const cookingTime = document.getElementById("cookingTime");

  if (!method) {
    methodDescription.textContent = "Njia hii haihitajiki kwa chakula hiki.";
    stepsList.innerHTML = ""; cookingTime.textContent = "-";
    return;
  }
  methodDescription.textContent = method.description || "";
  cookingTime.textContent = method.cooking_time || "-";
  stepsList.innerHTML = "";
  (method.steps || []).forEach((step) => { const li = document.createElement("li"); li.textContent = step; stepsList.appendChild(li); });
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab-btn")) {
    currentMethod = e.target.dataset.method;
    renderMethod(currentMethod);
  }
});

/* ================= Favorites ================= */
let favoritesCache = [];

async function loadFavoritesCache() {
  const headers = await getAuthHeader();
  const res = await fetch("/api/favorites", { headers });
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
  const isFav = favoritesCache.some((f) => f.food_name === currentData.food_name);

  if (isFav) {
    await fetch(`/api/favorites?food_name=${encodeURIComponent(currentData.food_name)}`, { method: "DELETE", headers });
  } else {
    await fetch("/api/favorites", { method: "POST", headers, body: JSON.stringify({ food_name: currentData.food_name, data: currentData }) });
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
  preview.style.display = "none";
  uploadText.style.display = "block";
  result.style.display = "none";
  currentData = null; compressedBlob = null; hasImage = false;
});

/* ================= Page Tabs ================= */
const pageTabs = document.querySelectorAll(".page-tab-btn");
const pages = {
  scan: document.getElementById("scanPage"),
  pro: document.getElementById("proPage"),
  history: document.getElementById("historyPage"),
  favorites: document.getElementById("favoritesPage"),
};
pageTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    pageTabs.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(pages).forEach(([key, el]) => { el.style.display = key === btn.dataset.page ? "block" : "none"; });
    if (btn.dataset.page === "history") renderHistory();
    if (btn.dataset.page === "favorites") renderFavorites();
  });
});

/* ================= History / Favorites Rendering ================= */
function renderCard(entry, container) {
  const card = document.createElement("div");
  card.className = "list-card";
  card.innerHTML = `<strong>${entry.food_name}</strong><span class="list-card-origin">${entry.data?.origin || ""}</span>`;
  card.addEventListener("click", () => openViewModal(entry.data));
  container.appendChild(card);
}

async function renderHistory() {
  const headers = await getAuthHeader();
  const res = await fetch("/api/history", { headers });
  const list = res.ok ? await res.json() : [];
  const container = document.getElementById("historyList");
  const emptyMsg = document.getElementById("historyEmpty");
  container.innerHTML = "";
  if (list.length === 0) { emptyMsg.style.display = "block"; return; }
  emptyMsg.style.display = "none";
  list.forEach((entry) => renderCard(entry, container));
}

async function renderFavorites() {
  const list = await loadFavoritesCache();
  const container = document.getElementById("favoritesList");
  const emptyMsg = document.getElementById("favoritesEmpty");
  container.innerHTML = "";
  if (list.length === 0) { emptyMsg.style.display = "block"; return; }
  emptyMsg.style.display = "none";
  list.forEach((entry) => renderCard(entry, container));
}

/* ================= View Modal ================= */
const viewModal = document.getElementById("viewModal");
const viewContent = document.getElementById("viewContent");
document.getElementById("closeViewBtn").addEventListener("click", () => { viewModal.style.display = "none"; });
viewModal.addEventListener("click", (e) => { if (e.target === viewModal) viewModal.style.display = "none"; });

function openViewModal(entry) {
  const method = entry.cooking_methods?.jiko_kawaida;
  const nutrition = entry.nutrition || {};
  viewContent.innerHTML = `
    <h2 style="color:#d35400;">${entry.food_name}</h2>
    <p class="origin">Asili: ${entry.origin || "-"}</p>
    <h3>🧂 Ingredients</h3>
    <ul>${(entry.ingredients || []).map((i) => `<li>${i}</li>`).join("")}</ul>
    <h3>🔥 Lishe</h3>
    <p>Calories: ${nutrition.calories || "-"} | Protini: ${nutrition.protein || "-"} | Wanga: ${nutrition.carbs || "-"} | Mafuta: ${nutrition.fat || "-"}</p>
    <h3>👩‍🍳 Jiko la Kawaida</h3>
    <ol>${(method?.steps || []).map((s) => `<li>${s}</li>`).join("")}</ol>
    <p><strong>⏱ Muda:</strong> ${method?.cooking_time || "-"}</p>
    <p class="tips"><strong>💡 Tip:</strong> ${entry.tips || "-"}</p>
  `;
  viewModal.style.display = "flex";
}

/* ================= Pro Page ================= */
document.getElementById("proSubmitBtn").addEventListener("click", async () => {
  const ingredients = document.getElementById("proIngredients").value.trim();
  const proError = document.getElementById("proError");
  const proResults = document.getElementById("proResults");
  const proLoading = document.getElementById("proLoading");

  proError.style.display = "none";
  proResults.innerHTML = "";

  if (!ingredients) {
    proError.textContent = "❌ Andika angalau kiungo kimoja";
    proError.style.display = "block";
    return;
  }

  proLoading.style.display = "block";
  try {
    const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
    const res = await fetch("/api/pro-suggest", {
      method: "POST", headers,
      body: JSON.stringify({ ingredients, lang: currentLang || "sw" }),
    });
    const data = await res.json();

    if (res.status === 401) { showAuthModal(); throw new Error("Tafadhali ingia kwanza."); }
    if (res.status === 429) throw new Error(`${data.message}`);
    if (!res.ok) throw new Error(data.error || "Hitilafu imetokea");

    (data.suggestions || []).forEach((s) => {
      const card = document.createElement("div");
      card.className = "pro-card";
      card.innerHTML = `
        <strong>${s.food_name}</strong>
        <p>${s.short_description}</p>
        <p class="pro-extra"><em>Utahitaji ziada: ${(s.extra_needed || []).join(", ") || "hakuna"}</em></p>
      `;
      proResults.appendChild(card);
    });
    refreshQuota();
  } catch (err) {
    proError.textContent = "❌ " + err.message;
    proError.style.display = "block";
  } finally {
    proLoading.style.display = "none";
  }
});

/* ================= About Modal ================= */
const aboutBtn = document.getElementById("aboutBtn");
const closeAboutBtn = document.getElementById("closeAboutBtn");
const aboutModal = document.getElementById("aboutModal");
aboutBtn.addEventListener("click", () => { aboutModal.style.display = "flex"; });
closeAboutBtn.addEventListener("click", () => { aboutModal.style.display = "none"; });
aboutModal.addEventListener("click", (e) => { if (e.target === aboutModal) aboutModal.style.display = "none"; });

/* ================= Admin Panel ================= */
const adminPanelBtn = document.getElementById("adminPanelBtn");
const adminModal = document.getElementById("adminModal");
const closeAdminBtn = document.getElementById("closeAdminBtn");

let userIsAdmin = false;

async function checkAdminStatus() {
  try {
    const headers = await getAuthHeader();
    const res = await fetch("/api/profile", { headers });
    if (!res.ok) return;
    const data = await res.json();
    userIsAdmin = !!data.is_admin;
    adminPanelBtn.style.display = userIsAdmin ? "block" : "none";
  } catch {}
}

adminPanelBtn.addEventListener("click", () => {
  userMenuModal.style.display = "none";
  adminModal.style.display = "flex";
  loadAdminSettings();
});
closeAdminBtn.addEventListener("click", () => { adminModal.style.display = "none"; });

document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("adminSettingsTab").style.display = btn.dataset.atab === "settings" ? "block" : "none";
    document.getElementById("adminUsersTab").style.display = btn.dataset.atab === "users" ? "block" : "none";
    if (btn.dataset.atab === "users") loadAdminUsers();
  });
});

async function loadAdminSettings() {
  const headers = await getAuthHeader();
  const res = await fetch("/api/admin/settings", { headers });
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById("currentGeminiKey").textContent = data.gemini_api_key_masked || "-";
  document.getElementById("defaultLimitInput").value = data.default_message_limit || 5;
  document.getElementById("referralBonusInput").value = data.referral_bonus_messages || 5;
}

function showAdminMsg(text) {
  const el = document.getElementById("adminSettingsMsg");
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 3000);
}

document.getElementById("saveGeminiKeyBtn").addEventListener("click", async () => {
  const key = document.getElementById("newGeminiKey").value.trim();
  if (!key) return;
  const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
  await fetch("/api/admin/settings", { method: "POST", headers, body: JSON.stringify({ gemini_api_key: key }) });
  document.getElementById("newGeminiKey").value = "";
  showAdminMsg("✅ Gemini API key imesasishwa");
  loadAdminSettings();
});

document.getElementById("clearGeminiKeyBtn").addEventListener("click", async () => {
  const headers = await getAuthHeader();
  await fetch("/api/admin/settings/cl
