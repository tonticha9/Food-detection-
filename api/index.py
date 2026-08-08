<!DOCTYPE html>
<html lang="sw">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tambua Chakula - Recipe Finder</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">
</head>
<body>

  <div class="container">
    <h1>🍲 Tambua Chakula</h1>
    <p class="subtitle">Piga picha ya chakula chochote duniani, upate jina, ingredients na jinsi ya kupika</p>

    <form id="foodForm">
      <label for="cameraInput" class="upload-box">
        <span id="uploadText">📷 Bonyeza kupiga/kupakia picha</span>
        <img id="preview" style="display:none;" />
      </label>

      <input type="file" id="cameraInput" name="cameraImage" accept="image/*" capture="environment" style="display:none;">
      <input type="file" id="galleryInput" name="galleryImage" accept="image/*" style="display:none;">

      <div class="button-row">
        <button type="button" id="cameraBtn">📷 Piga Picha</button>
        <button type="button" id="galleryBtn">🖼️ Chagua kwenye Gallery</button>
      </div>

      <button type="submit" id="submitBtn">Tambua Chakula</button>
    </form>

    <div id="loading" style="display:none;">
      <p>⏳ Inatambua chakula, subiri kidogo...</p>
    </div>

    <div id="result" style="display:none;">
      <h2 id="foodName"></h2>
      <p id="origin" class="origin"></p>
      <p id="confidence" class="confidence"></p>

      <h3>🧂 Ingredients</h3>
      <ul id="ingredientsList"></ul>

      <h3>👩‍🍳 Jinsi ya Kupika</h3>
      <div class="method-tabs">
        <button type="button" class="tab-btn active" data-method="jiko_kawaida">🔥 Jiko la Kawaida</button>
        <button type="button" class="tab-btn" data-method="njia_ya_kisasa">⚡ Njia ya Kisasa</button>
      </div>
      <p id="methodDescription" class="method-desc"></p>
      <ol id="stepsList"></ol>
      <p><strong>⏱ Muda wa kupika:</strong> <span id="cookingTime"></span></p>

      <p class="tips"><strong>💡 Tip:</strong> <span id="tips"></span></p>

      <button id="tryAgainBtn">Piga Picha Nyingine</button>
    </div>

    <div id="errorBox" style="display:none;" class="error"></div>

    <footer class="footer">
      <button type="button" id="aboutBtn" class="about-btn">👨‍💻 Kuhusu App Hii</button>
      <p>Imetengenezwa kwa ❤️ na Braiton Living &middot; Tanzania</p>
    </footer>

    <div id="aboutModal" class="modal-overlay" style="display:none;">
      <div class="modal-box">
        <button type="button" id="closeAboutBtn" class="modal-close">✕</button>
        <h3>👨‍💻 Kuhusu App Hii</h3>
        <p>
          App hii iliundwa na <strong>Braiton Living</strong> — mtengenezaji wa
          programu kutoka Tanzania, akitumia fursa za teknolojia ya AI kuleta
          suluhisho la vitendo kwa jamii. Lengo ni kuwezesha mtu yeyote,
          popote alipo, kupata maelekezo sahihi ya kupika chakula chochote
          duniani kwa lugha anayoielewa vizuri.
        </p>
        <p>
          Mradi huu ni sehemu ya juhudi za kuleta ubunifu wa kiteknolojia
          karibu na watu wa kawaida — bila gharama kubwa, bila utata, moja
          kwa moja kutoka kwenye simu mkononi.
        </p>
      </div>
    </div>
  </div>

  <script src="{{ url_for('static', filename='script.js') }}"></script>
</body>
</html>
