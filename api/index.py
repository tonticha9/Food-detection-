import os
import json
import io

from flask import Flask, request, jsonify, render_template
from google import genai
from google.genai import types
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

SYSTEM_PROMPT = """Wewe ni mtaalamu wa upishi mwenye ujuzi wa vyakula vyote duniani,
unayefundisha wapishi wapya kwa ufasaha na uelewa mzuri.

Utapewa picha ya chakula. Tambua jina lake, toa ingredients kwa VIPIMO SAHIHI
(vikombe, vijiko, gramu, kilo - si maneno ya jumla tu), kisha toa NJIA MBILI za
kupika: "jiko_kawaida" (mkaa/gesi/sufuria ya kawaida, bila oveni/vifaa maalum)
na "njia_ya_kisasa" (oveni, blender, air fryer au vifaa vya kisasa kama
vinafaa kwa chakula hicho).

MWONGOZO WA UBORA:
- Kila kiungo lazima kiwe na kipimo (mfano "Vikombe 2 vya unga wa ngano",
  siyo "unga" tu)
- Ingredients: vitu 6 hadi 10 kulingana na uhalisia wa chakula
- Steps kwa kila njia: hatua 5 hadi 8 kulingana na uhalisia wa chakula
- Kila hatua iwe sentensi 1-2 zenye MAELEZO YA KUTOSHA - eleza JINSI (mfano
  "koroga polepole") na wakati muhimu KWA NINI (mfano "ili isivunjike"),
  lakini bila kuzidisha maneno yasiyo ya lazima. Lengo la maneno: 15-30 kwa
  kila hatua.
- Description ya kila njia: sentensi 1 fupi inayoeleza mtindo mzima
- Tips: nasaha 1-2 zenye manufaa halisi ya kiupishi
- MUHIMU: Kila hatua iwe MSTARI MMOJA tu, bila kubonyeza Enter/newline ndani
  ya maandishi ya hatua moja

Andika kwa Kiswahili sanifu, rahisi kueleweka na mtu asiyejua kupika.

Kama njia ya kisasa haihitajiki kabisa kwa chakula hicho (mfano wali wa
kawaida), rudisha "njia_ya_kisasa" kama null.

Jibu JSON pekee, muundo huu, bila maandishi mengine:

{
  "food_name": "jina",
  "confidence": "high/medium/low",
  "origin": "asili",
  "ingredients": ["kipimo + kiungo 1", "kipimo + kiungo 2"],
  "cooking_methods": {
    "jiko_kawaida": {
      "description": "sentensi 1 fupi",
      "steps": ["hatua yenye maelezo 1", "hatua yenye maelezo 2"],
      "cooking_time": "muda"
    },
    "njia_ya_kisasa": {
      "description": "sentensi 1 fupi au null",
      "steps": ["hatua yenye maelezo 1", "hatua yenye maelezo 2"],
      "cooking_time": "muda"
    }
  },
  "tips": "nasaha 1-2 fupi"
}"""


def extract_json_block(text):
    """Chukua JSON kamili ya kwanza kutoka kwenye text kwa kufuatilia { }."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def parse_json_safely(text):
    """Jaribu njia kadhaa kupata JSON sahihi, ikiwemo kuruhusu control
    characters (newlines halisi) ndani ya strings ambazo Gemini wakati
    mwingine huziacha bila kuzi-escape."""

    # Njia 1: parse ya kawaida (strict)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Njia 2: parse ikiruhusu control characters ndani ya strings
    try:
        return json.loads(text, strict=False)
    except json.JSONDecodeError:
        pass

    # Njia 3: chukua JSON block kamili kwa bracket-matching, kisha jaribu
    # strict na non-strict
    block = extract_json_block(text)
    if block:
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            pass
        try:
            return json.loads(block, strict=False)
        except json.JSONDecodeError:
            pass

    return None


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/identify-food", methods=["POST"])
def identify_food():
    if "image" not in request.files:
        return jsonify({"error": "Hakuna picha iliyotumwa"}), 400

    image_file = request.files["image"]

    try:
        img = Image.open(image_file.stream)
        img = img.convert("RGB")
        img.thumbnail((1024, 1024))

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        image_bytes = buffer.getvalue()

        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                SYSTEM_PROMPT,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3,
                max_output_tokens=12000,
            ),
        )

        raw_text = response.text
        finish_reason = None
        try:
            finish_reason = str(response.candidates[0].finish_reason)
        except Exception:
            pass

        if not raw_text:
            return jsonify({
                "error": f"Gemini haikurudisha jibu (finish_reason: {finish_reason})"
            }), 500

        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json\n", "", 1).replace("json", "", 1)
            cleaned = cleaned.strip()

        result = parse_json_safely(cleaned)

        if result is None:
            return jsonify({
                "error": f"Model imeshindwa kutoa JSON sahihi (finish_reason: {finish_reason}, urefu: {len(raw_text)} herufi)",
                "raw_response": raw_text[:2000]
            }), 500

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
