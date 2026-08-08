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

SYSTEM_PROMPT = """Wewe ni mtaalamu wa upishi mwenye ujuzi wa vyakula vyote duniani.

Utapewa picha ya chakula. Tambua jina lake, toa ingredients, kisha toa NJIA MBILI
FUPI za kupika: "jiko_kawaida" (mkaa/gesi/sufuria ya kawaida, bila oveni/vifaa
maalum) na "njia_ya_kisasa" (oveni, blender, air fryer au vifaa vya kisasa
kama vinafaa kwa chakula hicho).

MUHIMU: Weka hatua (steps) FUPI na za moja kwa moja - sentensi 1 fupi kwa kila
hatua, si maelezo marefu. Lengo ni JSON ifupi lakini kamili, isikatike kabla
ya kuisha.

Kama njia ya kisasa haihitajiki kabisa kwa chakula hicho (mfano wali wa
kawaida), rudisha "njia_ya_kisasa" kama null.

Jibu JSON pekee, muundo huu, bila maandishi mengine:

{
  "food_name": "jina",
  "confidence": "high/medium/low",
  "origin": "asili",
  "ingredients": ["kiungo 1", "kiungo 2"],
  "cooking_methods": {
    "jiko_kawaida": {
      "description": "sentensi 1 fupi",
      "steps": ["hatua fupi 1", "hatua fupi 2"],
      "cooking_time": "muda"
    },
    "njia_ya_kisasa": {
      "description": "sentensi 1 fupi au null",
      "steps": ["hatua fupi 1", "hatua fupi 2"],
      "cooking_time": "muda"
    }
  },
  "tips": "ushauri 1 mfupi"
}"""


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
                max_output_tokens=4096,
            ),
        )

        raw_text = response.text

        if not raw_text:
            return jsonify({
                "error": "Gemini haikurudisha jibu lolote (labda picha haikutambulika au ilizuiwa na safety filter)"
            }), 500

        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json\n", "", 1).replace("json", "", 1)
            cleaned = cleaned.strip()

        try:
            result = json.loads(cleaned)
        except json.JSONDecodeError:
            return jsonify({
                "error": "Model imeshindwa kutoa JSON sahihi, jaribu tena",
                "raw_response": raw_text[:800]
            }), 500

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
