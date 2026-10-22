import os
import json
import io
import datetime
import uuid

import psycopg2
import psycopg2.extras
import jwt as pyjwt
import bcrypt
from flask import Flask, request, jsonify, render_template, send_from_directory
from google import genai
from google.genai import types
from PIL import Image

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR   = os.path.join(BASE_DIR, "static")

app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)

ENV_GEMINI_KEY  = os.environ.get("GEMINI_API_KEY")
DATABASE_URL    = os.environ.get("DATABASE_URL")
JWT_SECRET      = os.environ.get("JWT_SECRET", "tambua-chakula-default-secret")
JWT_ALGORITHM   = "HS256"
JWT_EXPIRY_DAYS = 7

ADMIN_EMAIL    = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or ""

LANG_NAMES = {"sw": "Kiswahili", "en": "English", "fr": "Français"}

# =====================================================================
# PROMPTS & SCHEMAS
# =====================================================================

SYSTEM_PROMPT_TEMPLATE = """Wewe ni mtaalamu wa upishi na lishe mwenye ujuzi wa
vyakula vyote duniani, unayefundisha wapishi WAPYA KABISA (wasiojua kupika hata
kidogo) kwa uvumilivu na uwazi mkubwa.

Andika JIBU LOTE kwa lugha ya {lang_name} pekee (majina ya vyakula yanaweza
kubaki kwa lugha asilia kama hayana tafsiri nzuri).

HATUA YA KWANZA YA LAZIMA - THIBITISHA KAMA NI CHAKULA:
Kabla ya kufanya kitu kingine chochote, angalia picha KWA UANGALIFU MKUBWA.
Weka "is_food": true TU KAMA picha inaonyesha chakula halisi kilichopikwa au
kiko tayari kuliwa. Weka "is_food": false kama picha inaonyesha kitu
KISICHOKUWA CHAKULA - mfano: mtu, mnyama hai, gari, jengo, mti, kitu cha
nyumbani kisicho chakula, screenshot, maandishi, au chochote kisichohusiana
na chakula. USIBUNI wala USIKISIE chakula kama huoni chakula halisi kwenye
picha - hii ni MUHIMU SANA, usijaribu "kusaidia" kwa kutengeneza jibu la
uongo.

Kama is_food ni false: weka food_name kama "", ingredients kama [], tips kama
maelezo mafupi (kwa lugha ya {lang_name}) ukimwambia mtumiaji picha
haionyeshi chakula, na omba apige picha nyingine ya chakula halisi.
Cooking_methods.jiko_kawaida weka description="" na steps=[] na
cooking_time="".

Kama is_food ni true, endelea na hatua zifuatazo:

Tambua jina lake, toa ingredients kwa VIPIMO SAHIHI,
makadirio ya lishe, kisha toa NJIA MBILI za kupika: "jiko_kawaida" (mkaa/gesi/
sufuria ya kawaida) na "njia_ya_kisasa" (oveni/blender/air fryer, au null kama
havihitajiki).

MUHIMU SANA KUHUSU HATUA (steps) - HII NDIYO SEHEMU MUHIMU ZAIDI:
Kila hatua LAZIMA iwe maelezo YA KINA na YENYE UWAZI KAMILI, kama ungekuwa
unamfundisha mtu ambaye hajawahi kuingia jikoni kabisa. USIWE MFUPI. Eleza:
- Ni nini cha kufanya hasa (kitendo)
- Kwa vitu gani (viungo, vyombo)
- Jinsi gani (mfano: "katakata vipande vidogo vidogo", si "katakata" tu)
- Kwa muda gani au mpaka hali gani ionekane (mfano: "hadi vitunguu viwe
  vya rangi ya dhahabu", si "kaanga" tu)

Mfano wa ubora unaotakiwa:
"Andaa sufuria safi yenye ukubwa wa kutosha kulingana na idadi ya watu
watakaokula chakula hiki."
"Menya na osha vitunguu na nyanya, kisha kata vitunguu vipande vidogo vidogo
na nyanya vipande vya wastani, weka kila kimoja kwenye bakuli tofauti."
"Weka sufuria jikoni kwenye moto wa wastani, mimina mafuta kiasi cha
kutosha, subiri sekunde 30 mpaka mafuta yapate joto kabla ya kuweka
vitunguu."

Hatua hizo zinaweza kuwa ndefu - HILO NI SAWA na LINATAKIWA. Lengo ni user
AELEWE KIKAMILIFU bila kuhitaji kuuliza swali lolote la ziada.

MWONGOZO MWINGINE:
- Kila kiungo lazima kiwe na kipimo
- Ingredients: vitu 6 hadi 10
- Steps kwa kila njia: hatua 6 hadi 10, kila moja ikiwa na maelezo kamili
  kama mfano hapo juu
- Tips: nasaha 2-3 zenye maelezo, si sentensi fupi tu

Jibu JSON pekee, muundo huu:
{{
  "is_food": true,
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

PRO_PROMPT_TEMPLATE = """Wewe ni mtaalamu wa upishi anayefundisha watu wapya
kabisa jikoni. Mtumiaji ameandika hivi kama viungo alivyonavyo nyumbani:
"{ingredients}".

HATUA YA KWANZA YA LAZIMA - THIBITISHA KAMA NI VIUNGO HALISI VYA CHAKULA:
Angalia maandishi haya kwa uangalifu. Weka "is_valid": true TU KAMA maandishi
haya yanaeleza viungo halisi vya chakula (mfano: unga, mafuta, nyanya, kuku,
sukari, n.k), hata kama vimeandikwa kwa lugha isiyo rasmi au yenye makosa
kidogo ya spelling. Weka "is_valid": false kama maandishi ni kitu kisicho
viungo vya chakula kabisa - mfano: majina ya watu, maneno yasiyo na maana,
vitu vya nyumbani visivyoliwa, au maandishi ya ovyo/random. USIBUNI vyakula
kama hujaona viungo halisi vya chakula - hii ni MUHIMU SANA.

Kama is_valid ni false: weka suggestions kama [] (array tupu), na weka
"message" (kwa lugha ya {lang_name}) ukimwambia mtumiaji aandike viungo halisi
vya chakula alivyonavyo nyumbani.

Kama is_valid ni true: weka message kama "", kisha toa mapendekezo ya vyakula
3 hadi 5 anavyoweza kupika kwa kutumia viungo hivyo (au pamoja na vitu vya
kawaida vinavyopatikana kila nyumbani kama chumvi/maji/mafuta). Kwa KILA
pendekezo, toa hatua ZENYE MAELEZO YA KINA na UWAZI KAMILI - kama ungekuwa
unamfundisha mtu asiyejua kupika kabisa. Eleza kitendo, vifaa, jinsi gani, na
kwa muda/hali gani (mfano: "kaanga hadi kiwe cha rangi ya dhahabu", si
"kaanga" tu). Hatua zinaweza kuwa ndefu - hilo ni sawa, lengo ni UELEWA KAMILI.

Andika JIBU LOTE kwa lugha ya {lang_name}.

Jibu JSON pekee, muundo huu:
{{
  "is_valid": true,
  "message": "",
  "suggestions": [
    {{
      "food_name": "jina la chakula",
      "short_description": "sentensi 1-2 kuhusu chakula hiki",
      "extra_needed": ["kiungo cha ziada 1"],
      "steps": ["hatua yenye maelezo kamili 1", "hatua yenye maelezo kamili 2"]
    }}
  ]
}}"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "is_food": {"type": "boolean"},
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
    "required": ["is_food", "food_name", "confidence", "origin", "ingredients", "nutrition", "cooking_methods", "tips"],
}

PRO_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "is_valid": {"type": "boolean"},
        "message": {"type": "string"},
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
    "required": ["is_valid", "message", "suggestions"],
}


# =====================================================================
# DATABASE HELPERS
# =====================================================================

def get_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return conn


def db_query(sql, params=(), fetchone=False, fetchall=False, commit=False):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        result = None
        if fetchone:
            result = cur.fetchone()
            if result:
                result = dict(result)
        elif fetchall:
            rows = cur.fetchall()
            result = [dict(r) for r in rows]
        if commit:
            conn.commit()
        cur.close()
        return result
    finally:
        conn.close()


# =====================================================================
# AUTH HELPERS
# =====================================================================

def get_authenticated_user(req):
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ", 1)[1]
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "id": payload["sub"],
            "email": payload.get("email", ""),
            "user_metadata": {"full_name": payload.get("full_name", "")},
        }
    except Exception:
        return None


def is_admin(user_id):
    row = db_query("SELECT 1 FROM admins WHERE user_id = %s", (user_id,), fetchone=True)
    return row is not None


def require_admin(req):
    user = get_authenticated_user(req)
    if not user:
        return None, (jsonify({"error": "Login required"}), 401)
    if not is_admin(user["id"]):
        return None, (jsonify({"error": "Huna ruhusa ya admin"}), 403)
    return user, None


def make_token(user_id, email, full_name):
    exp = datetime.datetime.utcnow() + datetime.timedelta(days=JWT_EXPIRY_DAYS)
    return pyjwt.encode(
        {"sub": str(user_id), "email": email, "full_name": full_name or "", "exp": exp},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def ensure_admin(user_id, email, password):
    """Kama email na password zinafanana na ADMIN_EMAIL/ADMIN_PASSWORD
       kwenye ENV, mtumiaji huyu anafanywa admin automatically."""
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        return
    if email.strip().lower() != ADMIN_EMAIL:
        return
    if password != ADMIN_PASSWORD:
        return
    # Ongeza kwenye admins kama bado hayupo
    db_query(
        "INSERT INTO admins (user_id) VALUES (%s) ON CONFLICT DO NOTHING",
        (user_id,),
        commit=True,
    )


# =====================================================================
# SETTINGS HELPERS
# =====================================================================

def get_setting(key, default=""):
    row = db_query("SELECT value FROM app_settings WHERE key = %s", (key,), fetchone=True)
    return row["value"] if row else default


def set_setting(key, value):
    db_query(
        "INSERT INTO app_settings (key, value) VALUES (%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (key, value),
        commit=True,
    )


def get_gemini_client():
    db_key = get_setting("gemini_api_key", "")
    active_key = db_key if db_key else ENV_GEMINI_KEY
    return genai.Client(api_key=active_key)


# =====================================================================
# PROFILE / QUOTA HELPERS
# =====================================================================

def get_or_create_profile(user_id, full_name=""):
    row = db_query("SELECT * FROM profiles WHERE id = %s", (user_id,), fetchone=True)
    if row:
        return row

    default_limit = int(get_setting("default_message_limit", "5"))
    today = datetime.date.today()
    new_row = db_query(
        """INSERT INTO profiles
               (id, full_name, messages_used_today, messages_limit,
                bonus_messages, last_reset_date, referral_count)
           VALUES (%s, %s, 0, %s, 0, %s, 0)
           RETURNING *""",
        (user_id, full_name or "Mtumiaji", default_limit, today),
        fetchone=True,
        commit=True,
    )
    return new_row or {
        "id": user_id,
        "full_name": full_name or "Mtumiaji",
        "messages_used_today": 0,
        "messages_limit": default_limit,
        "bonus_messages": 0,
        "last_reset_date": str(today),
        "referral_count": 0,
    }


def reset_quota_if_new_day(profile):
    today = datetime.date.today()
    last  = profile.get("last_reset_date")
    if last:
        if isinstance(last, str):
            last = datetime.date.fromisoformat(last)
        if last != today:
            db_query(
                "UPDATE profiles SET messages_used_today = 0, last_reset_date = %s WHERE id = %s",
                (today, profile["id"]),
                commit=True,
            )
            profile["messages_used_today"] = 0
            profile["last_reset_date"]     = str(today)
    return profile


def increment_usage(user_id, current_used):
    db_query(
        "UPDATE profiles SET messages_used_today = %s WHERE id = %s",
        (current_used + 1, user_id),
        commit=True,
    )


def save_history(user_id, food_name, data):
    db_query(
        "INSERT INTO history (user_id, food_name, data) VALUES (%s, %s, %s::jsonb)",
        (user_id, food_name, json.dumps(data)),
        commit=True,
    )


def check_and_consume_quota(user):
    full_name = user.get("user_metadata", {}).get("full_name", "")
    prof      = get_or_create_profile(user["id"], full_name)
    prof      = reset_quota_if_new_day(prof)

    if is_admin(user["id"]):
        return prof, None, True

    total_allowed = prof["messages_limit"] + prof.get("bonus_messages", 0)
    if prof["messages_used_today"] >= total_allowed:
        return prof, (jsonify({
            "error":     "quota_exceeded",
            "message":   "Umefikia kikomo cha leo. Share link na marafiki 2+ kupata messages za ziada!",
            "share_url": "https://world-food-scanner.vercel.app",
        }), 429), False
    return prof, None, False


# =====================================================================
# AUTH ENDPOINTS
# =====================================================================

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    body      = request.get_json() or {}
    email     = (body.get("email") or "").strip().lower()
    password  = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email na password vinahitajika"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password iwe na herufi 6 au zaidi"}), 400

    try:
        existing = db_query("SELECT id FROM profiles WHERE email = %s", (email,), fetchone=True)
        if existing:
            return jsonify({"error": "Email hii tayari imesajiliwa"}), 400

        user_id   = str(uuid.uuid4())
        pw_hash   = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        def_limit = int(get_setting("default_message_limit", "5"))
        today     = datetime.date.today()

        db_query(
            """INSERT INTO profiles
                   (id, email, password_hash, full_name,
                    messages_used_today, messages_limit, bonus_messages,
                    last_reset_date, referral_count)
               VALUES (%s, %s, %s, %s, 0, %s, 0, %s, 0)""",
            (user_id, email, pw_hash, full_name or "Mtumiaji", def_limit, today),
            commit=True,
        )

        # Kama ni admin email+password → fanya admin automatically
        ensure_admin(user_id, email, password)

        token = make_token(user_id, email, full_name)
        return jsonify({
            "token": token,
            "user":  {"id": user_id, "email": email, "full_name": full_name},
        }), 201

    except Exception as e:
        return jsonify({"error": f"Hitilafu: {str(e)}"}), 500


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    body     = request.get_json() or {}
    email    = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email na password vinahitajika"}), 400

    try:
        row = db_query(
            "SELECT id, email, password_hash, full_name FROM profiles WHERE email = %s",
            (email,),
            fetchone=True,
        )
        if not row:
            return jsonify({"error": "Email au password si sahihi"}), 401

        if not bcrypt.checkpw(password.encode("utf-8"), row["password_hash"].encode("utf-8")):
            return jsonify({"error": "Email au password si sahihi"}), 401

        # Kama ni admin email+password → hakikisha yuko kwenye admins
        ensure_admin(str(row["id"]), row["email"], password)

        token = make_token(row["id"], row["email"], row["full_name"] or "")
        return jsonify({
            "token": token,
            "user":  {
                "id":        str(row["id"]),
                "email":     row["email"],
                "full_name": row["full_name"] or "",
            },
        })

    except Exception as e:
        return jsonify({"error": f"Hitilafu: {str(e)}"}), 500


# =====================================================================
# STATIC ROUTES
# =====================================================================

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.json", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    return send_from_directory(STATIC_DIR, "sw.js", mimetype="application/javascript")


# =====================================================================
# API ENDPOINTS
# =====================================================================

@app.route("/api/profile", methods=["GET"])
def profile():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Haujaingia (login required)"}), 401

    full_name  = user.get("user_metadata", {}).get("full_name", "")
    prof       = get_or_create_profile(user["id"], full_name)
    prof       = reset_quota_if_new_day(prof)
    admin_flag = is_admin(user["id"])

    remaining = prof["messages_limit"] + prof.get("bonus_messages", 0) - prof["messages_used_today"]
    return jsonify({
        "id":                  user["id"],
        "email":               user.get("email", ""),
        "full_name":           prof.get("full_name"),
        "messages_used_today": prof["messages_used_today"],
        "messages_limit":      prof["messages_limit"],
        "bonus_messages":      prof.get("bonus_messages", 0),
        "remaining":           max(0, remaining),
        "is_admin":            admin_flag,
    })


@app.route("/api/claim-referral-bonus", methods=["POST"])
def claim_referral_bonus():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Login required"}), 401

    prof         = get_or_create_profile(user["id"], user.get("user_metadata", {}).get("full_name", ""))
    bonus        = int(get_setting("referral_bonus_messages", "5"))
    new_bonus    = prof.get("bonus_messages", 0) + bonus
    new_referral = prof.get("referral_count", 0) + 1

    db_query(
        "UPDATE profiles SET bonus_messages = %s, referral_count = %s WHERE id = %s",
        (new_bonus, new_referral, user["id"]),
        commit=True,
    )
    return jsonify({"bonus_messages": new_bonus, "referral_count": new_referral})


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

    lang_code  = request.form.get("lang", "sw")
    lang_name  = LANG_NAMES.get(lang_code, "Kiswahili")
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
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                system_prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=0.3,
                max_output_tokens=16000,
            ),
        )

        raw_text = response.text
        if not raw_text:
            return jsonify({"error": "Gemini haikurudisha jibu"}), 500

        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError:
            result = json.loads(raw_text, strict=False)

        is_valid_food = result.get("is_food", True)
        if is_valid_food:
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

    body        = request.get_json() or {}
    ingredients = (body.get("ingredients") or "").strip()
    lang_code   = body.get("lang", "sw")
    lang_name   = LANG_NAMES.get(lang_code, "Kiswahili")

    if not ingredients:
        return jsonify({"error": "Andika angalau kiungo kimoja"}), 400

    try:
        prompt        = PRO_PROMPT_TEMPLATE.format(ingredients=ingredients, lang_name=lang_name)
        gemini_client = get_gemini_client()

        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PRO_RESPONSE_SCHEMA,
                temperature=0.4,
                max_output_tokens=10000,
            ),
        )

        raw_text = response.text
        if not raw_text:
            return jsonify({"error": "Gemini haikurudisha jibu"}), 500

        try:
            result = json.loads(raw_text)
        except json.JSONDecodeError:
            result = json.loads(raw_text, strict=False)

        is_valid_ingredients = result.get("is_valid", True)
        if is_valid_ingredients and not is_unlimited:
            increment_usage(user["id"], prof["messages_used_today"])

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": f"Hitilafu imetokea: {str(e)}"}), 500


@app.route("/api/history", methods=["GET"])
def get_history():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Login required"}), 401

    rows = db_query(
        "SELECT id, user_id, food_name, data, created_at FROM history "
        "WHERE user_id = %s ORDER BY created_at DESC LIMIT 50",
        (user["id"],),
        fetchall=True,
    ) or []
    for r in rows:
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
    return jsonify(rows)


@app.route("/api/favorites", methods=["GET", "POST", "DELETE"])
def favorites():
    user = get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Login required"}), 401

    if request.method == "GET":
        rows = db_query(
            "SELECT id, user_id, food_name, data, created_at FROM favorites "
            "WHERE user_id = %s ORDER BY created_at DESC",
            (user["id"],),
            fetchall=True,
        ) or []
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = r["created_at"].isoformat()
        return jsonify(rows)

    if request.method == "POST":
        body = request.get_json() or {}
        db_query(
            "INSERT INTO favorites (user_id, food_name, data) VALUES (%s, %s, %s::jsonb) "
            "ON CONFLICT (user_id, food_name) DO NOTHING",
            (user["id"], body.get("food_name"), json.dumps(body.get("data"))),
            commit=True,
        )
        return jsonify({"ok": True})

    if request.method == "DELETE":
        food_name = request.args.get("food_name", "")
        db_query(
            "DELETE FROM favorites WHERE user_id = %s AND food_name = %s",
            (user["id"], food_name),
            commit=True,
        )
        return jsonify({"ok": True})


# =====================================================================
# ADMIN ENDPOINTS
# =====================================================================

@app.route("/api/admin/users", methods=["GET"])
def admin_list_users():
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    rows = db_query(
        "SELECT id, email, full_name, messages_used_today, messages_limit, "
        "bonus_messages, referral_count, created_at FROM profiles ORDER BY created_at DESC",
        fetchall=True,
    ) or []
    for r in rows:
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
    return jsonify(rows)


@app.route("/api/admin/users/<user_id>", methods=["DELETE"])
def admin_delete_user(user_id):
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp
    db_query("DELETE FROM profiles WHERE id = %s", (user_id,), commit=True)
    return jsonify({"ok": True})


@app.route("/api/admin/users/<user_id>/limit", methods=["POST"])
def admin_update_user_limit(user_id):
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    body      = request.get_json() or {}
    new_limit = body.get("messages_limit")
    if new_limit is None:
        return jsonify({"error": "messages_limit inahitajika"}), 400

    db_query(
        "UPDATE profiles SET messages_limit = %s WHERE id = %s",
        (int(new_limit), user_id),
        commit=True,
    )
    return jsonify({"ok": True})


@app.route("/api/admin/settings", methods=["GET"])
def admin_get_settings():
    _, error_resp = require_admin(request)
    if error_resp:
        return error_resp

    rows     = db_query("SELECT key, value FROM app_settings", fetchall=True) or []
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

    if body.get("gemini_api_key"):
        set_setting("gemini_api_key", body["gemini_api_key"])

    if "default_message_limit" in body:
        set_setting("default_message_limit", str(body["default_message_limit"]))
        if body.get("apply_to_all"):
            db_query(
                "UPDATE profiles SET messages_limit = %s",
                (int(body["default_message_limit"]),),
                commit=True,
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