import os
import json
import io

from flask import Flask, request, jsonify, render_template
from google import genai
from google.genai import types
from PIL import Image

app = Flask(__name__)

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
        # Punguza size ya picha kabla ya kutuma (gharama na speed)
        img = Image.open(image_file.stream)
        img = img.convert("RGB")
        img.thumbnail((1024, 1024))  # resize bila kuharibu ubora

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        image_bytes = buffer.getvalue()

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                SYSTEM_PROMPT,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3,
            ),
        )

        result = json.loads(response.text)

        # Hapa unaweza kuhifadhi PostgreSQL kama history
        # save_to_history(user_id, result)

        return jsonify(result), 200

    except json.JSONDecodeError:
        return jsonify({"error": "Model imeshindwa kutoa response sahihi, jaribu tena"}), 500
    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
