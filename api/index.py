import os
import json
import io

from flask import Flask, request, jsonify, render_template, send_from_directory
from google import genai
from google.genai import types
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

SYSTEM_PROMPT = """Wewe ni mtaalamu wa upishi na lishe mwenye ujuzi wa vyakula
vyote duniani, unayefundisha wapishi wapya kwa ufasaha na uelewa mzuri.

Utapewa picha ya chakula. Tambua jina lake, toa ingredients kwa VIPIMO SAHIHI
(vikombe, vijiko, gramu, kilo - si maneno ya jumla tu), toa makadirio ya
lishe (calories, protini, wanga, mafuta kwa sahani moja ya kawaida), kisha
toa NJIA MBILI za kupika: "jiko_kawaida" (mkaa/gesi/sufuria ya kawaida, bila
oveni/vifaa maalum) na "njia_ya_kisasa" (oveni, blender, air fryer au vifaa
vya kisasa kama vinafaa kwa chakula hicho, au null kama havihitajiki).

MWONGOZO WA UBORA:
- Kila kiungo lazima kiwe na kipimo (mfano "Vikombe 2 vya unga wa ngano")
- Ingredients: vitu 6 hadi 10
- Nutrition: makadirio ya wastani kwa sahani moja ya kawaida (si sahihi kabisa,
  ni makadirio tu - sema hivyo kwenye nutrition_note)
- Steps kwa kila njia: hatua 5 hadi 8
- Kila hatua iwe sentensi 1-2 zenye maelezo ya JINSI na KWA NINI, maneno 15-30
- Description ya kila njia: sentensi 1 fupi
- Tips: nasaha 1-2 fupi

Andika kwa Kiswahili sanifu, rahisi kueleweka na mtu asiyejua kupika."""


RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "food_name": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "origin": {"type": "string"},
        "ingredients": {
            "type": "array",
            "items": {"type": "string"}
        },
        "nutrition": {
            "type": "object",
            "properties": {
                "calories": {"type": "string"},
                "protein": {"type": "string"},
                "carbs": {"type": "string"},
                "fat": {"type": "string"},
                "nutrition_note": {"type": "string"},
            },
            "required": ["calories", "protein", "carbs", "fat", "nutrition_note"],
        },
        "cooking_methods": {
            "type": "object",
            "properties": {
                "jiko_kawaida": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string"},
                        "steps": {"type": "array", "items": {"type": "string"}},
                        "cooking_time": {"type": "string"},
                    },
                    "required": ["description", "steps", "cooking_time"],
                },
                "njia_ya_kisasa": {
                    "type": "object",
                    "nullable": True,
                    "properties": {
                        "description": {"type": "string"},
                        "steps": {"type": "array", "items": {"type": "string"}},
                        "cooking_time": {"type": "string"},
                    },
                },
            },
            "required": ["jiko_kawaida"],
        },
        "tips": {"type": "string"},
    },
    "required": ["food_name", "confidence", "origin", "ingredients", "nutrition", "cooking_methods", "tips"],
}


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.json", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    return send_from_directory(STATIC_DIR, "sw.js", mimetype="application/javascript")


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
                response_schema=RESPONSE_SCHEMA,
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

        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError:
            try:
                result = json.loads(raw_text, strict=False)
            except json.JSONDecodeError:
                return jsonify({
                    "error": f"Model imeshindwa kutoa JSON sahihi (finish_reason: {finish_reason}, urefu: {len(raw_text)} herufi)",
                    "raw_response": raw_text[:2000]
                }), 500

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
