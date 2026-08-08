const form = document.getElementById("foodForm");
const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const uploadText = document.getElementById("uploadText");
const loading = document.getElementById("loading");
const result = document.getElementById("result");
const errorBox = document.getElementById("errorBox");
const submitBtn = document.getElementById("submitBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");

let currentData = null;
let currentMethod = "jiko_kawaida";

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
    uploadText.style.display = "none";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = imageInput.files[0];
  if (!file) return;

  result.style.display = "none";
  errorBox.style.display = "none";
  loading.style.display = "block";
  submitBtn.disabled = true;

  const formData = new FormData();
  formData.append("image", file);

  try {
    const response = await fetch("/api/identify-food", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      const debugInfo = data.raw_response ? `\n\nGemini alisema: ${data.raw_response}` : "";
      throw new Error((data.error || "Hitilafu imetokea") + debugInfo);
    }

    currentData = data;
    currentMethod = "jiko_kawaida";
    displayResult(data);
  } catch (err) {
    errorBox.textContent = "❌ " + err.message;
    errorBox.style.display = "block";
  } finally {
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
    const li = document.createElement("li");
    li.textContent = item;
    ingredientsList.appendChild(li);
  });

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

tryAgainBtn.addEventListener("click", () => {
  form.reset();
  preview.style.display = "none";
  uploadText.style.display = "block";
  result.style.display = "none";
  currentData = null;
});
