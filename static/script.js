/* ---------- Elements ---------- */
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

/* ---------- Local Storage Helpers ---------- */
const HISTORY_KEY = "tambua_chakula_history";
const FAVORITES_KEY = "tambua_chakula_favorites";

function loadList(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function saveList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}

function addToHistory(data) {
  const list = loadList(HISTORY_KEY);
  const entry = { ...data, _id: Date.now().toString(), _date: new Date().toISOString() };
  list.unshift(entry);
  if (list.length > 50) list.pop(); // limit ya kuepuka kujaza storage
  saveList(HISTORY_KEY, list);
  return entry;
}

function isFavorited(foodName) {
  return loadList(FAVORITES_KEY).some((f) => f.food_name === foodName);
}

function toggleFavorite(data) {
  let favs = loadList(FAVORITES_KEY);
  const exists = favs.find((f) => f.food_name === data.food_name);
  if (exists) {
    favs = favs.filter((f) => f.food_name !== data.food_name);
  } else {
    favs.unshift({ ...data, _id: Date.now().toString(), _date: new Date().toISOString() });
  }
  saveList(FAVORITES_KEY, favs);
  return !exists;
}

/* ---------- Image compression ---------- */
function compressImage(file, maxSize = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;

    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round((height * maxSize) / width);
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Imeshindwa kubana picha"));
      }, "image/jpeg", quality);
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
  try {
    compressedBlob = await compressImage(file);
  } catch {
    compressedBlob = file;
  }
}

cameraBtn.addEventListener("click", () => cameraInput.click());
galleryBtn.addEventListener("click", () => galleryInput.click());
cameraInput.addEventListener("change", () => handleFileSelected(cameraInput.files[0]));
galleryInput.addEventListener("change", () => handleFileSelected(galleryInput.files[0]));

/* ---------- Submit / API call ---------- */
const loadingMessages = [
  "🔍 Inatambua chakula...",
  "🧂 Inatafuta viungo...",
  "👩‍🍳 Inaandaa maelekezo...",
  "🔥 Karibu tumemaliza..."
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
function stopLoadingAnimation() {
  clearInterval(loadingInterval);
}

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

  try {
    const response = await fetch("/api/identify-food", { method: "POST", body: formData });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Picha ni kubwa mno au server imeshindwa kujibu. Jaribu picha nyingine.");
    }

    const data = await response.json();

    if (!response.ok) {
      const debugInfo = data.raw_response ? `\n\nGemini alisema: ${data.raw_response}` : "";
      throw new Error((data.error || "Hitilafu imetokea") + debugInfo);
    }

    currentData = data;
    currentMethod = "jiko_kawaida";
    addToHistory(data);
    displayResult(data);
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

/* ---------- Display result ---------- */
function displayResult(data) {
  document.getElementById("foodName").textContent = data.food_name || "Haijulikani";
  document.getElementById("origin").textContent = data.origin ? `Asili: ${data.origin}` : "";
  document.getElementById("confidence").textContent = `Uhakika: ${data.confidence || "-"}`;
  document.getElementById("tips").textContent = data.tips || "-";

  const ingredientsList = document.getElementById("ingredientsList");
  ingredientsList.innerHTML = "";
  (data.ingredients || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ingredientsList.appendChild(li);
  });

  const nutrition = data.nutrition || {};
  document.getElementById("nutCalories").textContent = nutrition.calories || "-";
  document.getElementById("nutProtein").textContent = nutrition.protein || "-";
  document.getElementById("nutCarbs").textContent = nutrition.carbs || "-";
  document.getElementById("nutFat").textContent = nutrition.fat || "-";
  document.getElementById("nutritionNote").textContent = nutrition.nutrition_note || "";

  favBtn.textContent = isFavorited(data.food_name) ? "★" : "☆";
  favBtn.classList.toggle("active", isFavorited(data.food_name));

  renderMethod(currentMethod);
  result.style.display = "block";
}

function renderMethod(methodKey) {
  if (!currentData || !currentData.cooking_methods) return;
  const method = currentData.cooking_methods[methodKey];

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.method === methodKey);
  });

  const stepsList = document.getElementById("stepsList");
  const methodDescription = document.getElementById("methodDescription");
  const cookingTime = document.getElementById("cookingTime");

  if (!method) {
    methodDescription.textContent = "Njia hii haihitajiki kwa chakula hiki.";
    stepsList.innerHTML = "";
    cookingTime.textContent = "-";
    return;
  }

  methodDescription.textContent = method.description || "";
  cookingTime.textContent = method.cooking_time || "-";
  stepsList.innerHTML = "";
  (method.steps || []).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    stepsList.appendChild(li);
  });
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab-btn")) {
    currentMethod = e.target.dataset.method;
    renderMethod(currentMethod);
  }
});

favBtn.addEventListener("click", () => {
  if (!currentData) return;
  const nowFav = toggleFavorite(currentData);
  favBtn.textContent = nowFav ? "★" : "☆";
  favBtn.classList.toggle("active", nowFav);
  renderFavorites();
});

shareBtn.addEventListener("click", () => {
  if (!currentData) return;
  const method = currentData.cooking_methods?.[currentMethod];
  let text = `🍲 *${currentData.food_name}*\n\n`;
  text += `🧂 *Ingredients:*\n${(currentData.ingredients || []).map((i) => "- " + i).join("\n")}\n\n`;
  if (method) {
    text += `👩‍🍳 *Jinsi ya Kupika (${currentMethod === "jiko_kawaida" ? "Jiko la Kawaida" : "Njia ya Kisasa"}):*\n`;
    text += (method.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n");
  }
  text += `\n\nImetambuliwa kwa Tambua Chakula app - world-food-scanner.vercel.app`;

  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
});

tryAgainBtn.addEventListener("click", () => {
  form.reset();
  preview.style.display = "none";
  uploadText.style.display = "block";
  result.style.display = "none";
  currentData = null;
  compressedBlob = null;
  hasImage = false;
});

/* ---------- Page tabs (Scan / History / Favorites) ---------- */
const pageTabs = document.querySelectorAll(".page-tab-btn");
const pages = { scan: document.getElementById("scanPage"), history: document.getElementById("historyPage"), favorites: document.getElementById("favoritesPage") };

pageTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    pageTabs.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(pages).forEach(([key, el]) => {
      el.style.display = key === btn.dataset.page ? "block" : "none";
    });
    if (btn.dataset.page === "history") renderHistory();
    if (btn.dataset.page === "favorites") renderFavorites();
  });
});

/* ---------- Render History / Favorites lists ---------- */
function renderCard(entry, container) {
  const card = document.createElement("div");
  card.className = "list-card";
  card.innerHTML = `
    <strong>${entry.food_name}</strong>
    <span class="list-card-origin">${entry.origin || ""}</span>
  `;
  card.addEventListener("click", () => openViewModal(entry));
  container.appendChild(card);
}

function renderHistory() {
  const list = loadList(HISTORY_KEY);
  const container = document.getElementById("historyList");
  const emptyMsg = document.getElementById("historyEmpty");
  container.innerHTML = "";
  if (list.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";
  list.forEach((entry) => renderCard(entry, container));
}

function renderFavorites() {
  const list = loadList(FAVORITES_KEY);
  const container = document.getElementById("favoritesList");
  const emptyMsg = document.getElementById("favoritesEmpty");
  container.innerHTML = "";
  if (list.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";
  list.forEach((entry) => renderCard(entry, container));
}

/* ---------- View modal (kuona recipe kutoka history/favorites) ---------- */
const viewModal = document.getElementById("viewModal");
const viewContent = document.getElementById("viewContent");
document.getElementById("closeViewBtn").addEventListener("click", () => {
  viewModal.style.display = "none";
});
viewModal.addEventListener("click", (e) => {
  if (e.target === viewModal) viewModal.style.display = "none";
});

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

/* ---------- About modal ---------- */
const aboutBtn = document.getElementById("aboutBtn");
const closeAboutBtn = document.getElementById("closeAboutBtn");
const aboutModal = document.getElementById("aboutModal");
aboutBtn.addEventListener("click", () => { aboutModal.style.display = "flex"; });
closeAboutBtn.addEventListener("click", () => { aboutModal.style.display = "none"; });
aboutModal.addEventListener("click", (e) => { if (e.target === aboutModal) aboutModal.style.display = "none"; });

/* ---------- PWA: register service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/* ---------- Initial render ---------- */
renderHistory();
renderFavorites();
