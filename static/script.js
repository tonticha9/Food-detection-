const form = document.getElementById("foodForm");
const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const uploadText = document.getElementById("uploadText");
const loading = document.getElementById("loading");
const result = document.getElementById("result");
const errorBox = document.getElementById("errorBox");
const submitBtn = document.getElementById("submitBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");

// Onyesha preview ya picha mara tu ikichaguliwa
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

  // Reset UI
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
      throw new Error(data.error || "Hitilafu imetokea");
    }

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
  document.getElementById("cookingTime").textContent = data.cooking_time || "-";
  document.getElementById("tips").textContent = data.tips || "-";

  const ingredientsList = document.getElementById("ingredientsList");
  ingredientsList.innerHTML = "";
  (data.ingredients || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ingredientsList.appendChild(li);
  });

  const stepsList = document.getElementById("stepsList");
  stepsList.innerHTML = "";
  (data.steps || []).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    stepsList.appendChild(li);
  });

  result.style.display = "block";
}

tryAgainBtn.addEventListener("click", () => {
  form.reset();
  preview.style.display = "none";
  uploadText.style.display = "block";
  result.style.display = "none";
});
