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

ENV_GEMINI_KEY = os.environ.get("GEMINI_API_KEY")

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
nyumbani, kama chumvi/maji/mafuta). Kwa KILA pendekezo, toa PIA hatua fupi za
namna ya kuvitengeneza (hatua 4-6, maneno 15-25 kila hatua) - si maelezo
mafupi tu, bali maelekezo kamili ya kupika chakula hicho.

Andika JIBU LOTE kwa lugha ya {lang_name}.

Jibu JSON pekee, muundo huu:
{{
  "suggestions": [
    {{
      "food_name": "jina la chakula",
      "short_description": "sentensi 1-2 fupi kuhusu chakula hiki",
      "extra_needed": ["kiungo cha ziada 1", "kiungo cha ziada 2"],
      "steps": ["hatua 1", "hatua 2", "hatua 3"]
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
                    "steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["food_name", "short_description", "extra_needed", "steps"],
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


def is_admin(user_id):
    resp = requests.get(
        f"{REST_URL}/admins",
        headers=SERVICE_HEADERS,
        params={"user_id": f"eq.{user_id}", "select": "user_id"},
        timeout=10,
    )
    return resp.status_code == 200 and len(resp.json()) > 0


def require_admin(req):
    user = get_authenticated_user(req)
    if not user:
        return None, (jsonify({"error": "Login required"}), 401)
    if not is_admin(user["id"]):
        return None, (jsonify({"error": "Huna ruhusa ya admin"}), 403)
    return user, None


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


def set_setting(key, value):
    requests.post(
        f"{REST_URL}/app_settings",
        headers={**SERVICE_HEADERS, "Prefer": "resolution=merge-duplicates"},
        json={"key": key, "value": value},
        timeout=10,
    )


def get_gemini_client():
    db_key = get_setting("gemini_api_key", "")
    active_key = db_key if db_key else ENV_GEMINI_KEY
    return genai.Client(api_key=active_key)


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
    """Rudisha (profile, error_response, is_unlimited)."""
    full_name = user.get("user_metadata", {}).get("full_name", "")
    prof = get_or_create_profile(user["id"], full_name)
    prof = reset_quota_if_new_day(prof)

    if is_admin(user["id"]):
        return prof, None, True

    total_allowed = prof["messages_limit"] + prof.get("bonus_messages", 0)
    if prof["messages_used_today"] >= total_allowed:
        return prof, (jsonify({
            "error": "quota_exceeded",
            "message": "Umefikia kikomo cha leo. Share link na marafiki 2+ kupata messages za ziada!",
            "share_url": "https://world-food-scanner.vercel.app"
        }), 429), False
    return prof, None, False


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
    admin_flag = is_admin(user["id"])

    remaining = prof["messages_limit"] + prof.get("bonus_messages", 0) - prof["messages_used_today"]
    return jsonify({
        "full_name": prof.get("full_name"),
        "email": user.get("email", ""),
        "messages_used_today": prof["messages_used_today"],
        "messages_limit": prof["messages_limit"],
        "bonus_messages": prof.get("bonus_messages", 0),
        "remaining": max(0, remaining),
        "is_admin": admin_flag,
    })


@app.route("/api/claim-referral-bonus", methods=["POST"])
def claim_referral_bonus():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Login required"}), 401

    prof = get_or_create_profile(user["id"], user.get("user_metadata", {}).get("full_name", ""))
    bonus = int(get_setting("referral_bonus_messages", "5"))

    new_bonus = prof.get("bonus_messages", 0) + bonus
    new_referral_count = prof.get("referral_count", 0) + 1

    requests.patch(
        f"{REST_URL}/profiles",
        headers=SERVICE_HEADERS,
        params={"id": f"eq.{user['id']}"},
        json={"bonus_messages": new_bonus, "referral_count": new_referral_count},
        timeout=10,
    )

    return jsonify({"bonus_messages": new_bonus, "referral_count": new_referral_count})


@app.route("/api/identify-food", methods=["POST"])
def identify_food():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Tafadhali ingia (login) kwanza kutumia app hii"}), 401

    prof, error_resp, is_unlimited = check_and_consume_quota(user)
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
        gemini_client = get_gemini_client()

        response = gemini_client.models.generate_content(
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

        if not is_unlimited:
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

    prof, error_resp, is_unlimited = check_and_consume_quota(user)
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
        gemini_client = get_gemini_client()

        response = gemini_client.models.generate_content(
            model="gemini-3.5-flash",
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PRO_RESPONSE_SCHEMA,
                temperature=0.4,
                max_output_tokens=6000,
            ),
        )

        raw_text = response.text
        if not raw_text:
            return jsonify({"error": "Gemini haikurudisha jibu"}), 500

        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError:
            result = json.loads(raw_text, strict=False)

        if not is_unlimited:
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


# ============ ADMIN ENDPOINTS ============

@app.route("/api/admin/users", methods=["GET"])
def admin_list_users():
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    resp = requests.get(
        f"{REST_URL}/profiles",
        headers=SERVICE_HEADERS,
        params={"select": "*", "order": "created_at.desc"},
        timeout=10,
    )
    return jsonify(resp.json() if resp.status_code == 200 else [])


@app.route("/api/admin/users/<user_id>", methods=["DELETE"])
def admin_delete_user(user_id):
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    resp = requests.delete(
        f"{AUTH_URL}/admin/users/{user_id}",
        headers=SERVICE_HEADERS,
        timeout=10,
    )
    if resp.status_code not in (200, 204):
        return jsonify({"error": "Imeshindwa kufuta mtumiaji"}), 500
    return jsonify({"ok": True})


@app.route("/api/admin/users/<user_id>/limit", methods=["POST"])
def admin_update_user_limit(user_id):
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    body = request.get_json() or {}
    new_limit = body.get("messages_limit")
    if new_limit is None:
        return jsonify({"error": "messages_limit inahitajika"}), 400

    requests.patch(
        f"{REST_URL}/profiles",
        headers=SERVICE_HEADERS,
        params={"id": f"eq.{user_id}"},
        json={"messages_limit": int(new_limit)},
        timeout=10,
    )
    return jsonify({"ok": True})


@app.route("/api/admin/settings", methods=["GET"])
def admin_get_settings():
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    resp = requests.get(
        f"{REST_URL}/app_settings",
        headers=SERVICE_HEADERS,
        params={"select": "*"},
        timeout=10,
    )
    rows = resp.json() if resp.status_code == 200 else []
    settings = {r["key"]: r["value"] for r in rows}

    key = settings.get("gemini_api_key", "")
    if key:
        settings["gemini_api_key_masked"] = key[:6] + "..." + key[-4:] if len(key) > 10 else "***"
    else:
        settings["gemini_api_key_masked"] = "(inatumia Environment Variable)"
    settings.pop("gemini_api_key", None)

    return jsonify(settings)



@app.route("/api/admin/settings", methods=["POST"])
def admin_update_settings():
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    body = request.get_json() or {}

    if "gemini_api_key" in body and body["gemini_api_key"]:
        set_setting("gemini_api_key", body["gemini_api_key"])

    if "default_message_limit" in body:
        set_setting("default_message_limit", str(body["default_message_limit"]))

        if body.get("apply_to_all"):
            requests.patch(
                f"{REST_URL}/profiles",
                headers=SERVICE_HEADERS,
                params={"id": "not.is.null"},
                json={"messages_limit": int(body["default_message_limit"])},
                timeout=15,
            )

    if "referral_bonus_messages" in body:
        set_setting("referral_bonus_messages", str(body["referral_bonus_messages"]))

    return jsonify({"ok": True})

@app.route("/api/admin/settings/clear-gemini-key", methods=["POST"])
def admin_clear_gemini_key():
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp
    set_setting("gemini_api_key", "")
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
