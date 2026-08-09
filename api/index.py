import os
import json
import io
import datetime

import requests
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

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

REST_URL = f"{SUPABASE_URL}/rest/v1"
AUTH_URL = f"{SUPABASE_URL}/auth/v1"

SERVICE_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

LANG_NAMES = {"sw": "Kiswahili", "en": "English", "fr": "Français"}

SYSTEM_PROMPT_TEMPLATE = """Wewe ni mtaalamu wa upishi na lishe mwenye ujuzi wa
vyakula vyote duniani, unayefundisha wapishi wapya kwa ufasaha na uelewa mzuri.

Andika JIBU LOTE kwa lugha ya {lang_name} pekee (majina ya vyakula yanaweza
kubaki kwa lugha asilia kama hayana tafsiri nzuri).

Utapewa picha ya chakula. Tambua jina lake, toa ingredients kwa VIPIMO SAHIHI,
makadirio ya lishe (calories, protini, wanga, mafuta), kisha toa NJIA MBILI za
kupika: "jiko_kawaida" (mkaa/gesi/sufuria ya kawaida) na "njia_ya_kisasa"
(oveni/blender/air fryer, au null kama havihitajiki).

MWONGOZO WA UBORA:
- Kila kiungo lazima kiwe na kipimo
- Ingredients: vitu 6 hadi 10
- Steps kwa kila njia: hatua 5 hadi 8, maneno 15-30 kila hatua
- Tips: nasaha 1-2 fupi

Jibu JSON pekee, muundo huu:
{{
  "food_name": "jina",
  "confidence": "high/medium/low",
  "origin": "asili",
  "ingredients": ["kipimo + kiungo"],
  "nutrition": {{"calories":"","protein":"","carbs":"","fat":"","nutrition_note":""}},
  "cooking_methods": {{
    "jiko_kawaida": {{"description":"","steps":[""],"cooking_time":""}},
    "njia_ya_kisasa": {{"description":"","steps":[""],"cooking_time":""}}
  }},
  "tips": ""
}}"""

PRO_PROMPT_TEMPLATE = """Wewe ni mtaalamu wa upishi. Mtumiaji ana viungo hivi
nyumbani: "{ingredients}".

Toa mapendekezo ya vyakula 3 hadi 5 anavyoweza kupika kwa kutumia viungo hivyo
(au viungo hivyo pamoja na vitu vichache vya kawaida vinavyopatikana kila
nyumbani, kama chumvi/maji/mafuta). Kwa kila pendekezo, taja kama kuna kiungo
kimoja au viwili vya ziada anavyoweza kuhitaji kununua.

Andika JIBU LOTE kwa lugha ya {lang_name}.

Jibu JSON pekee, muundo huu:
{{
  "suggestions": [
    {{
      "food_name": "jina la chakula",
      "short_description": "sentensi 1-2 fupi kuhusu chakula hiki",
      "extra_needed": ["kiungo cha ziada 1", "kiungo cha ziada 2"]
    }}
  ]
}}"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "food_name": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "origin": {"type": "string"},
        "ingredients": {"type": "array", "items": {"type": "string"}},
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

PRO_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "food_name": {"type": "string"},
                    "short_description": {"type": "string"},
                    "extra_needed": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["food_name", "short_description", "extra_needed"],
            },
        }
    },
    "required": ["suggestions"],
}


def get_authenticated_user(req):
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ", 1)[1]
    resp = requests.get(
        f"{AUTH_URL}/user",
        headers={"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code != 200:
        return None
    return resp.json()


def get_setting(key, default=""):
    resp = requests.get(
        f"{REST_URL}/app_settings",
        headers=SERVICE_HEADERS,
        params={"key": f"eq.{key}", "select": "value"},
        timeout=10,
    )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]["value"]
    return default


def get_or_create_profile(user_id, full_name=""):
    resp = requests.get(
        f"{REST_URL}/profiles",
        headers=SERVICE_HEADERS,
        params={"id": f"eq.{user_id}", "select": "*"},
        timeout=10,
    )
    rows = resp.json() if resp.status_code == 200 else []
    if rows:
        return rows[0]

    default_limit = get_setting("default_message_limit", "5")
    payload = {
        "id": user_id,
        "full_name": full_name or "Mtumiaji",
        "messages_used_today": 0,
        "messages_limit": int(default_limit),
        "bonus_messages": 0,
        "last_reset_date": str(datetime.date.today()),
        "referral_count": 0,
    }
    create_resp = requests.post(
        f"{REST_URL}/profiles",
        headers={**SERVICE_HEADERS, "Prefer": "return=representation"},
        json=payload,
        timeout=10,
    )
    if create_resp.status_code in (200, 201):
        data = create_resp.json()
        return data[0] if isinstance(data, list) else data
    return payload


def reset_quota_if_new_day(profile):
    today = str(datetime.date.today())
    if profile.get("last_reset_date") != today:
        requests.patch(
            f"{REST_URL}/profiles",
            headers=SERVICE_HEADERS,
            params={"id": f"eq.{profile['id']}"},
            json={"messages_used_today": 0, "last_reset_date": today},
            timeout=10,
        )
        profile["messages_used_today"] = 0
        profile["last_reset_date"] = today
    return profile


def increment_usage(user_id, current_used):
    requests.patch(
        f"{REST_URL}/profiles",
        headers=SERVICE_HEADERS,
        params={"id": f"eq.{user_id}"},
        json={"messages_used_today": current_used + 1},
        timeout=10,
    )


def save_history(user_id, food_name, data):
    requests.post(
        f"{REST_URL}/history",
        headers=SERVICE_HEADERS,
        json={"user_id": user_id, "food_name": food_name, "data": data},
        timeout=10,
    )


def check_and_consume_quota(user):
    """Rudisha (profile, error_response) - error_response ni None kama sawa."""
    full_name = user.get("user_metadata", {}).get("full_name", "")
    prof = get_or_create_profile(user["id"], full_name)
    prof = reset_quota_if_new_day(prof)

    total_allowed = prof["messages_limit"] + prof.get("bonus_messages", 0)
    if prof["messages_used_today"] >= total_allowed:
        return prof, (jsonify({
            "error": "quota_exceeded",
            "message": "Umefikia kikomo cha leo. Share link na marafiki 2+ kupata messages za ziada!",
            "share_url": "https://world-food-scanner.vercel.app"
        }), 429)
    return prof, None


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.json", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    return send_from_directory(STATIC_DIR, "sw.js", mimetype="application/javascript")


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify({
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY", ""),
    })


@app.route("/api/profile", methods=["GET"])
def profile():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Haujaingia (login required)"}), 401

    full_name = user.get("user_metadata", {}).get("full_name", "")
    prof = get_or_create_profile(user["id"], full_name)
    prof = reset_quota_if_new_day(prof)

    remaining = prof["messages_limit"] + prof.get("bonus_messages", 0) - prof["messages_used_today"]
    return jsonify({
        "full_name": prof.get("full_name"),
        "messages_used_today": prof["messages_used_today"],
        "messages_limit": prof["messages_limit"],
        "bonus_messages": prof.get("bonus_messages", 0),
        "remaining": max(0, remaining),
    })


@app.route("/api/identify-food", methods=["POST"])
def identify_food():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Tafadhali ingia (login) kwanza kutumia app hii"}), 401

    prof, error_resp = check_and_consume_quota(user)
    if error_resp:
        return error_resp

    if "image" not in request.files:
        return jsonify({"error": "Hakuna picha iliyotumwa"}), 400

    lang_code = request.form.get("lang", "sw")
    lang_name = LANG_NAMES.get(lang_code, "Kiswahili")

    image_file = request.files["image"]

    try:
        img = Image.open(image_file.stream)
        img = img.convert("RGB")
        img.thumbnail((1024, 1024))

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        image_bytes = buffer.getvalue()

        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(lang_name=lang_name)

        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                system_prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=0.3,
                max_output_tokens=12000,
            ),
        )

        raw_text = response.text
        if not raw_text:
            return jsonify({"error": "Gemini haikurudisha jibu"}), 500

        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError:
            result = json.loads(raw_text, strict=False)

        increment_usage(user["id"], prof["messages_used_today"])
        save_history(user["id"], result.get("food_name", ""), result)

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


@app.route("/api/pro-suggest", methods=["POST"])
def pro_suggest():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Tafadhali ingia (login) kwanza kutumia app hii"}), 401

    prof, error_resp = check_and_consume_quota(user)
    if error_resp:
        return error_resp

    body = request.get_json() or {}
    ingredients = (body.get("ingredients") or "").strip()
    lang_code = body.get("lang", "sw")
    lang_name = LANG_NAMES.get(lang_code, "Kiswahili")

    if not ingredients:
        return jsonify({"error": "Andika angalau kiungo kimoja"}), 400

    try:
        prompt = PRO_PROMPT_TEMPLATE.format(ingredients=ingredients, lang_name=lang_name)

        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PRO_RESPONSE_SCHEMA,
                temperature=0.4,
                max_output_tokens=4000,
            ),
        )

        raw_text = response.text
        if not raw_text:
            return jsonify({"error": "Gemini haikurudisha jibu"}), 500

        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError:
            result = json.loads(raw_text, strict=False)

        increment_usage(user["id"], prof["messages_used_today"])

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


@app.route("/api/history", methods=["GET"])
def get_history():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Login required"}), 401
    resp = requests.get(
        f"{REST_URL}/history",
        headers=SERVICE_HEADERS,
        params={"user_id": f"eq.{user['id']}", "select": "*", "order": "created_at.desc", "limit": "50"},
        timeout=10,
    )
    return jsonify(resp.json() if resp.status_code == 200 else [])


@app.route("/api/favorites", methods=["GET", "POST", "DELETE"])
def favorites():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Login required"}), 401

    if request.method == "GET":
        resp = requests.get(
            f"{REST_URL}/favorites",
            headers=SERVICE_HEADERS,
            params={"user_id": f"eq.{user['id']}", "select": "*", "order": "created_at.desc"},
            timeout=10,
        )
        return jsonify(resp.json() if resp.status_code == 200 else [])

    if request.method == "POST":
        body = request.get_json()
        requests.post(
            f"{REST_URL}/favorites",
            headers=SERVICE_HEADERS,
            json={"user_id": user["id"], "food_name": body.get("food_name"), "data": body.get("data")},
            timeout=10,
        )
        return jsonify({"ok": True})

    if request.method == "DELETE":
        food_name = request.args.get("food_name", "")
        requests.delete(
            f"{REST_URL}/favorites",
            headers=SERVICE_HEADERS,
            params={"user_id": f"eq.{user['id']}", "food_name": f"eq.{food_name}"},
            timeout=10,
        )
        return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
