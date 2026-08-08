const form = document.getElementById("foodForm");
const cameraInput = document.getElementById("cameraInput");
const galleryInput = document.getElementById("galleryInput");
const cameraBtn = document.getElementById("cameraBtn");
const galleryBtn = document.getElementById("galleryBtn");
const preview = document.getElementById("preview");
const uploadText = document.getElementById("uploadText");
const loading = document.getElementById("loading");
const result = document.getElementById("result");
const errorBox = document.getElementById("errorBox");
const submitBtn = document.getElementById("submitBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");

let currentData = null;
let currentMethod = "jiko_kawaida";
let compressedBlob = null;
let hasImage = false;

// Punguza ukubwa wa picha kwa Canvas kabla ya kutuma
function compressImage(file, maxSize = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };
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

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Imeshindwa kubana picha"));
        },
        "image/jpeg",
        quality
      );
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
  } catch (err) {
    compressedBlob = file;
  }
}

cameraBtn.addEventListener("click", () => cameraInput.click());
galleryBtn.addEventListener("click", () => galleryInput.click());

cameraInput.addEventListener("change", () => {
  handleFileSelected(cameraInput.files[0]);
});

galleryInput.addEventListener("change", () => {
  handleFileSelected(galleryInput.files[0]);
});

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

  const formData = new FormData();
  formData.append("image", compressedBlob, "food.jpg");

  try {
    const response = await fetch("/api/identify-food", {
      method: "POST",
      body: formData,
    });

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
  compressedBlob = null;
  hasImage = false;
});
