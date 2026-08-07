import os
import json
import io

from flask import Flask, request, jsonify, render_template
from google import genai
from google.genai import types
from PIL import Image

# Elekeza Flask kwenye templates/ na static/ zilizoko root ya project,
# si ndani ya folder ya api/
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)

# API key inatoka Environment Variable - KAMWE usiiandike hapa moja kwa moja
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

SYSTEM_PROMPT = """Wewe ni mtaalamu wa upishi mwenye ujuzi wa vyakula vyote duniani -
Kiafrika, Kiasia, Kizungu, Kiarabu, Kilatini, na kadhalika.

Utapewa picha ya chakula kilichopikwa. Kazi yako:
1. Tambua jina la chakula (kama unakijua kwa uhakika)
2. Toa orodha kamili ya ingredients zinazohitajika kukipika
3. Toa hatua za kupika kutoka A mpaka Z, kwa njia rahisi kueleweka

Jibu LAZIMA liwe JSON pekee, muundo huu bila maandishi mengine yoyote:

{
  "food_name": "jina la chakula",
  "confidence": "high/medium/low",
  "origin": "chakula hiki kinatoka wapi",
  "ingredients": ["kipimo + kiungo 1", "kipimo + kiungo 2"],
  "steps": ["Hatua 1: ...", "Hatua 2: ..."],
  "cooking_time": "muda wa kupika",
  "tips": "ushauri wa ziada"
}

Kama huwezi kutambua chakula kwa uhakika, weka confidence "low" na jaribu
kukisia kwa kutumia muonekano wake (rangi, umbo, viungo vinavyoonekana)."""


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
                max_output_tokens=3048,
            ),
        )

        raw_text = response.text

        if not raw_text:
            return jsonify({
                "error": "Gemini haikurudisha jibu lolote (labda picha haikutambulika au ilizuiwa na safety filter)"
            }), 500

        # Safisha kama Gemini alifunga JSON kwenye ```json fences
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json\n", "", 1).replace("json", "", 1)
            cleaned = cleaned.strip()

        try:
            result = json.loads(cleaned)
        except json.JSONDecodeError:
            # Rudisha raw text ili tuone tatizo ni nini
            return jsonify({
                "error": "Model imeshindwa kutoa JSON sahihi",
                "raw_response": raw_text[:500]
            }), 500

        # Hapa unaweza kuhifadhi PostgreSQL kama history
        # save_to_history(user_id, result)

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
