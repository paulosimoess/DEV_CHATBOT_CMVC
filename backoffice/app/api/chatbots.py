from flask import Blueprint, request, jsonify, current_app, url_for
import json
from ..db import get_conn
from ..services.retreival import build_faiss_index
from werkzeug.utils import secure_filename
import traceback
import os
import shutil
from ..config import Config
from ..auth import login_required
from ..services.video_service import get_video_job_status

app = Blueprint('chatbots', __name__)

def _cleanup_chatbot_files(chatbot_id: int, icon_path: str = None) -> None:
    """Best-effort delete of local files belonging to a chatbot.

    - Removes uploaded icon under static/icons/
    - Removes results folder results/chatbot_<id>/ if present
    """
    try:
        # Delete icon only if it lives under /static/icons/
        if icon_path:
            # Handle both /static/icons/... and static/icons/... paths
            icon_path_str = str(icon_path)
            if icon_path_str.startswith("/static/icons/") or icon_path_str.startswith("static/icons/"):
                filename = icon_path_str.split("/")[-1]
                icons_dir = os.path.join(current_app.static_folder, "icons")
                fs_path = os.path.join(icons_dir, filename)
                if os.path.isfile(fs_path):
                    try:
                        os.remove(fs_path)
                        print(f"[_cleanup_chatbot_files] Deleted icon: {fs_path}")
                    except Exception as e:
                        print(f"[_cleanup_chatbot_files] Failed to delete icon {fs_path}: {e}")
    except Exception as e:
        print(f"[_cleanup_chatbot_files] Error cleaning icon: {e}")

    try:
        from ..services.video_service import ROOT, RESULTS_DIR
        result_root = RESULTS_DIR if RESULTS_DIR.is_absolute() else (ROOT / RESULTS_DIR)
        folder = result_root / f"chatbot_{chatbot_id}"
        if folder.exists() and folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
    except Exception:
        pass

def _save_chatbot_icon(file, chatbot_id: int, nome: str) -> str:
    """Save uploaded icon into static/icons with deterministic name 'nome_id.ext'."""
    original = secure_filename(file.filename or "")
    _, ext = os.path.splitext(original)
    ext = (ext or ".png").lower()
    safe_nome = secure_filename((nome or "").strip()) or "chatbot"
    filename = f"{safe_nome}_{chatbot_id}{ext}"
    icons_dir = os.path.join(current_app.static_folder, "icons")
    os.makedirs(icons_dir, exist_ok=True)
    fs_path = os.path.join(icons_dir, filename)
    file.save(fs_path)
    return url_for("static", filename=f"icons/{filename}")


def _save_chatbot_icon_preset(preset_filename: str, chatbot_id: int, nome: str) -> str:
    """Copy a preset avatar from static/images/avatars into static/icons and return its URL.

    Presets are allow-listed by filename to avoid path traversal.
    """
    preset_filename = secure_filename((preset_filename or "").strip())
    if not preset_filename:
        raise ValueError("Preset inválido")
    avatars_dir = os.path.join(current_app.static_folder, "images", "avatars")
    src_path = os.path.join(avatars_dir, preset_filename)
    if not os.path.isfile(src_path):
        raise FileNotFoundError("Preset não encontrado")

    _, ext = os.path.splitext(preset_filename)
    ext = (ext or ".png").lower()
    safe_nome = secure_filename((nome or "").strip()) or "chatbot"
    filename = f"{safe_nome}_{chatbot_id}{ext}"
    icons_dir = os.path.join(current_app.static_folder, "icons")
    os.makedirs(icons_dir, exist_ok=True)
    dest_path = os.path.join(icons_dir, filename)
    shutil.copyfile(src_path, dest_path)
    return url_for("static", filename=f"icons/{filename}")


@app.route("/chatbots", methods=["GET"])
def get_chatbots():
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT c.chatbot_id,
                   c.nome,
                   c.descricao,
                   c.data_criacao,
                   c.cor,
                   c.icon_path,
                   c.genero,
                   c.video_enabled,
                   c.ativo,
                   c.publicado,
                   fr.fonte,
                   array_remove(array_agg(cc.categoria_id), NULL) as categorias,
                   c.mensagem_sem_resposta,
                   c.greeting_video_text,
                   c.mensagem_inicial,
                   c.mensagem_feedback_positiva,
                   c.mensagem_feedback_negativa,
                   c.endereco
            FROM chatbot c
            LEFT JOIN fonte_resposta fr ON fr.chatbot_id = c.chatbot_id
            LEFT JOIN chatbot_categoria cc ON cc.chatbot_id = c.chatbot_id
            GROUP BY c.chatbot_id,
                     c.nome,
                     c.descricao,
                     c.data_criacao,
                     c.cor,
                     c.icon_path,
                     c.genero,
                     c.video_enabled,
                     c.ativo,
                     c.publicado,
                     fr.fonte,
                     c.mensagem_sem_resposta,
                     c.greeting_video_text,
                     c.mensagem_inicial,
                     c.mensagem_feedback_positiva,
                     c.mensagem_feedback_negativa,
                     c.endereco
            ORDER BY c.chatbot_id ASC
        """)
        data = cur.fetchall()
        return jsonify([
            {
                "chatbot_id": row[0],
                "nome": row[1],
                "descricao": row[2],
                "data_criacao": row[3],
                "cor": row[4] if row[4] else "#d4af37",
                "icon_path": row[5] if row[5] else "/static/images/chatbot/chatbot-icon.png",
                "genero": row[6] if row[6] else None,
                "video_enabled": bool(row[7]) if len(row) > 7 else False,
                "ativo": bool(row[8]) if len(row) > 8 else False,
                "publicado": bool(row[9]) if len(row) > 9 else False,
                "fonte": row[10] if row[10] else "faq",
                "categorias": row[11] if row[11] is not None else [],
                "mensagem_sem_resposta": row[12] if len(row) > 12 else "",
                "greeting_video_text": row[13] if len(row) > 13 else "",
                "mensagem_inicial": row[14] if len(row) > 14 else "",
                "mensagem_feedback_positiva": row[15] if len(row) > 15 else "",
                "mensagem_feedback_negativa": row[16] if len(row) > 16 else "",
                "endereco": row[17] if len(row) > 17 else "",
            }
            for row in data
        ])
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@app.route("/chatbots/<int:chatbot_id>/active", methods=["PUT"])
@login_required
def set_active_chatbot(chatbot_id: int):
    """Set the globally active chatbot (shared across all users/browsers)."""
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT 1 FROM chatbot WHERE chatbot_id = %s", (chatbot_id,))
        if not cur.fetchone():
            return jsonify({"success": False, "error": "Chatbot não encontrado."}), 404
        cur.execute("UPDATE chatbot SET ativo = FALSE WHERE ativo = TRUE")
        cur.execute("UPDATE chatbot SET ativo = TRUE, publicado = TRUE WHERE chatbot_id = %s", (chatbot_id,))
        conn.commit()
        return jsonify({"success": True, "chatbot_id": chatbot_id})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/chatbots/<int:chatbot_id>/publish", methods=["PUT"])
@login_required
def publish_chatbot(chatbot_id: int):
    """Publish chatbot without making it active."""
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT 1 FROM chatbot WHERE chatbot_id = %s", (chatbot_id,))
        if not cur.fetchone():
            return jsonify({"success": False, "error": "Chatbot não encontrado."}), 404
        cur.execute("UPDATE chatbot SET publicado = TRUE WHERE chatbot_id = %s", (chatbot_id,))
        conn.commit()
        return jsonify({"success": True, "chatbot_id": chatbot_id})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@app.route("/chatbots", methods=["POST"])
def criar_chatbot():
    conn = get_conn()
    cur = conn.cursor()
    data = request.get_json(silent=True) if request.is_json else None

    def _get_field(key: str, default=""):
        if data is not None:
            return data.get(key, default)
        return request.form.get(key, default)

    nome = (_get_field("nome", "") or "").strip()
    idioma = (_get_field("idioma", "pt") or "pt").strip().lower()
    idioma = idioma[:2] if idioma else "pt"
    if idioma not in {"pt", "en"}:
        idioma = "pt"
    descricao = (_get_field("descricao", "") or "").strip()
    categorias = _get_field("categorias", []) or []
    cor = (_get_field("cor", "") or "").strip() or "#d4af37"
    mensagem_sem_resposta = (_get_field("mensagem_sem_resposta", "") or "").strip()
    greeting_video_text = (_get_field("greeting_video_text", "") or "").strip()
    mensagem_inicial = (_get_field("mensagem_inicial", "") or "").strip()
    mensagem_feedback_positiva = (_get_field("mensagem_feedback_positiva", "") or "").strip()
    mensagem_feedback_negativa = (_get_field("mensagem_feedback_negativa", "") or "").strip()
    endereco = (_get_field("endereco", "") or "").strip()
    genero = _get_field("genero") or None
    fonte = (_get_field("fonte", "faq") or "faq").strip()
    if fonte not in ["faq", "faiss", "faq+raga"]:
        return jsonify({"success": False, "error": "Fonte inválida."}), 400

    # video_enabled can come as bool (json) or string (form)
    raw_video_enabled = _get_field("video_enabled", False)
    if isinstance(raw_video_enabled, str):
        video_enabled = raw_video_enabled.strip().lower() in {"1", "true", "yes", "on"}
    else:
        video_enabled = bool(raw_video_enabled)

    # icon_path can be provided explicitly (json) or via file upload (form)
    icon_path = _get_field("icon_path", "/static/images/chatbot/chatbot-icon.png") or "/static/images/chatbot/chatbot-icon.png"
    uploaded_icon = request.files.get("icon")
    icon_preset = (_get_field("icon_preset", "") or "").strip()

    if not nome:
        return jsonify({"success": False, "error": "Nome obrigatório."}), 400
    try:
        cur.execute(
            """
            INSERT INTO chatbot (
                nome,
                idioma,
                descricao,
                cor,
                icon_path,
                mensagem_sem_resposta,
                greeting_video_text,
                mensagem_inicial,
                mensagem_feedback_positiva,
                mensagem_feedback_negativa,
                endereco,
                genero,
                video_enabled
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (nome) DO NOTHING
            RETURNING chatbot_id
            """,
            (
                nome,
                idioma,
                descricao,
                cor,
                icon_path,
                mensagem_sem_resposta,
                greeting_video_text,
                mensagem_inicial,
                mensagem_feedback_positiva,
                mensagem_feedback_negativa,
                endereco,
                genero,
                video_enabled,
            )
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"success": False, "error": "Já existe um chatbot com esse nome."}), 409
        chatbot_id = row[0]

        # If icon was uploaded, save with deterministic name and store it
        if uploaded_icon and uploaded_icon.filename:
            try:
                icon_path = _save_chatbot_icon(uploaded_icon, chatbot_id, nome)
                cur.execute(
                    "UPDATE chatbot SET icon_path=%s WHERE chatbot_id=%s",
                    (icon_path, chatbot_id),
                )
            except Exception:
                # Best-effort: keep default icon_path
                pass
        elif icon_preset:
            # Preset avatar selected in UI
            try:
                icon_path = _save_chatbot_icon_preset(icon_preset, chatbot_id, nome)
                cur.execute(
                    "UPDATE chatbot SET icon_path=%s WHERE chatbot_id=%s",
                    (icon_path, chatbot_id),
                )
            except Exception:
                pass

        for categoria_id in categorias:
            cur.execute(
                "INSERT INTO chatbot_categoria (chatbot_id, categoria_id) VALUES (%s, %s)",
                (chatbot_id, categoria_id)
            )
        cur.execute(
            "INSERT INTO fonte_resposta (chatbot_id, fonte) VALUES (%s, %s)",
            (chatbot_id, fonte)
        )
        conn.commit()

        video_queued = False
        video_busy = False
        # If video is enabled, queue idle+greeting generation (may be busy)
        if video_enabled:
            from ..services.video_service import queue_videos_for_chatbot
            video_queued = bool(queue_videos_for_chatbot(chatbot_id))
            video_busy = not video_queued

        return jsonify(
            {
                "success": True,
                "chatbot_id": chatbot_id,
                "video_enabled": video_enabled,
                "video_queued": video_queued,
                "video_busy": video_busy,
                "icon_path": icon_path,
            }
        )
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/chatbots/<int:chatbot_id>", methods=["GET"])
def obter_nome_chatbot(chatbot_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT nome,
                   cor,
                   icon_path,
                   genero,
                     idioma,
                   video_greeting_path,
                   video_idle_path,
                   video_positive_path,
                   video_negative_path,
                   video_no_answer_path,
                   mensagem_sem_resposta,
                   greeting_video_text,
                   mensagem_inicial,
                   mensagem_feedback_positiva,
                   mensagem_feedback_negativa,
                   endereco
            FROM chatbot
            WHERE chatbot_id = %s
            """,
            (chatbot_id,),
        )
        row = cur.fetchone()
        if row:
            video_greeting_url = None
            video_idle_url = None
            video_positive_url = None
            video_negative_url = None
            video_no_answer_url = None
            if row[5]:
                import time
                from ..services.signed_media import sign_media
                exp = int(time.time()) + 3600
                nonce = str(int(time.time() * 1000))
                sig = sign_media("greeting", str(chatbot_id), exp, nonce, secret_fallback=Config.SECRET_KEY)
                video_greeting_url = url_for(
                    "api.video.video_greeting_for_chatbot",
                    chatbot_id=chatbot_id,
                    exp=exp,
                    nonce=nonce,
                    sig=sig,
                )
            if row[6]:
                import time
                from ..services.signed_media import sign_media
                exp = int(time.time()) + 3600
                nonce = str(int(time.time() * 1000))
                sig = sign_media("idle", str(chatbot_id), exp, nonce, secret_fallback=Config.SECRET_KEY)
                video_idle_url = url_for(
                    "api.video.video_idle_for_chatbot",
                    chatbot_id=chatbot_id,
                    exp=exp,
                    nonce=nonce,
                    sig=sig,
                )
            if row[7]:
                import time
                from ..services.signed_media import sign_media
                exp = int(time.time()) + 3600
                nonce = str(int(time.time() * 1000))
                sig = sign_media("positive", str(chatbot_id), exp, nonce, secret_fallback=Config.SECRET_KEY)
                video_positive_url = url_for(
                    "api.video.video_positive_for_chatbot",
                    chatbot_id=chatbot_id,
                    exp=exp,
                    nonce=nonce,
                    sig=sig,
                )
            if row[8]:
                import time
                from ..services.signed_media import sign_media
                exp = int(time.time()) + 3600
                nonce = str(int(time.time() * 1000))
                sig = sign_media("negative", str(chatbot_id), exp, nonce, secret_fallback=Config.SECRET_KEY)
                video_negative_url = url_for(
                    "api.video.video_negative_for_chatbot",
                    chatbot_id=chatbot_id,
                    exp=exp,
                    nonce=nonce,
                    sig=sig,
                )
            if row[9]:
                import time
                from ..services.signed_media import sign_media
                exp = int(time.time()) + 3600
                nonce = str(int(time.time() * 1000))
                sig = sign_media("no_answer", str(chatbot_id), exp, nonce, secret_fallback=Config.SECRET_KEY)
                video_no_answer_url = url_for(
                    "api.video.video_no_answer_for_chatbot",
                    chatbot_id=chatbot_id,
                    exp=exp,
                    nonce=nonce,
                    sig=sig,
                )
            return jsonify({
                "success": True,
                "nome": row[0],
                "cor": row[1] or "#d4af37",
                "icon": row[2] or "/static/images/chatbot/chatbot-icon.png",
                "genero": row[3],
                "idioma": (row[4] or "pt").strip().lower()[:2],
                "video_greeting_path": video_greeting_url or None,
                "video_idle_path": video_idle_url or None,
                "video_positive_path": video_positive_url or None,
                "video_negative_path": video_negative_url or None,
                "video_no_answer_path": video_no_answer_url or None,
                "mensagem_sem_resposta": row[9] or "",
                "greeting_video_text": row[10] or "",
                "mensagem_inicial": row[11] or "",
                "mensagem_feedback_positiva": row[12] or "",
                "mensagem_feedback_negativa": row[13] or "",
                "endereco": row[14] or "",
            })
        return jsonify({"success": False, "erro": "Chatbot não encontrado."}), 404
    except Exception as e:
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/chatbots/<int:chatbot_id>", methods=["PUT"])
def atualizar_chatbot(chatbot_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        # Block editing this chatbot if a FAQ video job for this chatbot is running
        job = get_video_job_status() or {}
        if job.get("status") in {"queued", "processing"} and job.get("kind") == "faq":
            try:
                jid = job.get("chatbot_id")
                if jid is not None and int(jid) == int(chatbot_id):
                    return (
                        jsonify(
                            {
                                "success": False,
                                "busy": True,
                                "error": "Não é possível editar este chatbot enquanto está a ser gerado o vídeo de uma FAQ deste chatbot.",
                            }
                        ),
                        409,
                    )
            except Exception:
                pass
        print("Dados recebidos:", dict(request.form))
        nome = request.form.get("nome", "").strip()
        idioma = (request.form.get("idioma", "") or "").strip().lower()
        if idioma:
            idioma = idioma[:2]
        descricao = request.form.get("descricao", "").strip()
        fonte = request.form.get("fonte", "faq")
        # Categories are managed via the dedicated endpoints (/chatbots/<id>/categorias)
        # from the frontend. When the JS submits the form with a custom FormData, it
        # may not include categorias[]. In that case we must NOT wipe existing links.
        categorias = request.form.getlist("categorias[]") if "categorias[]" in request.form else None
        cor = request.form.get("cor", "").strip() or "#d4af37"
        mensagem_sem_resposta = request.form.get("mensagem_sem_resposta", "").strip()
        greeting_video_text = request.form.get("greeting_video_text", "").strip()
        mensagem_inicial = request.form.get("mensagem_inicial", "").strip()
        mensagem_feedback_positiva = request.form.get("mensagem_feedback_positiva", "").strip()
        mensagem_feedback_negativa = request.form.get("mensagem_feedback_negativa", "").strip()
        endereco = request.form.get("endereco", "").strip()
        genero = request.form.get("genero") or None
        video_enabled = request.form.get("video_enabled") in ["true", "1", "on", "yes"]

        regen_videos = None
        if "regen_videos" in request.form:
            raw_regen = (request.form.get("regen_videos") or "").strip().lower()
            regen_videos = raw_regen in {"1", "true", "yes", "on"}

        requested_video_kinds = None
        if "video_kinds" in request.form:
            raw_kinds = (request.form.get("video_kinds") or "").strip()
            if raw_kinds:
                try:
                    parsed = json.loads(raw_kinds)
                    if isinstance(parsed, list):
                        requested_video_kinds = [str(x) for x in parsed]
                except Exception:
                    # allow comma-separated fallback
                    requested_video_kinds = [k.strip() for k in raw_kinds.split(",") if k.strip()]
        icon_path = None
        new_icon_uploaded = False
        if 'icon' in request.files:
            file = request.files['icon']
            if file and file.filename:
                try:
                    icon_path = _save_chatbot_icon(file, chatbot_id, nome)
                    new_icon_uploaded = True
                except Exception:
                    icon_path = None
        if not nome:
            return jsonify({"success": False, "error": "O nome do chatbot é obrigatório."}), 400
        
        # Get old values BEFORE updating (to compare if videos need regeneration)
        cur.execute(
            """
            SELECT nome,
                   icon_path,
                   genero,
                     idioma,
                   video_greeting_path,
                   video_idle_path,
                   video_enabled,
                   greeting_video_text,
                   mensagem_inicial,
                   mensagem_feedback_positiva,
                   mensagem_feedback_negativa,
                   mensagem_sem_resposta,
                   endereco
            FROM chatbot
            WHERE chatbot_id = %s
            """,
            (chatbot_id,),
        )
        old_row = cur.fetchone()
        old_nome = old_row[0] if old_row else None
        old_icon_path = old_row[1] if old_row else None
        old_genero = old_row[2] if old_row else None
        old_greeting_path = old_row[3] if old_row else None
        old_idle_path = old_row[4] if old_row else None
        old_video_enabled = bool(old_row[5]) if old_row and len(old_row) > 5 else False
        old_greeting_text = old_row[6] if old_row and len(old_row) > 6 else None
        old_mensagem_inicial = old_row[7] if old_row and len(old_row) > 7 else None
        old_msg_pos = old_row[8] if old_row and len(old_row) > 8 else None
        old_msg_neg = old_row[9] if old_row and len(old_row) > 9 else None
        old_msg_no_answer = old_row[10] if old_row and len(old_row) > 10 else None
        # If icon_path is None (no new icon uploaded), keep the old one
        if not icon_path and old_icon_path:
            icon_path = old_icon_path
        
        if icon_path:
            cur.execute(
                """
                UPDATE chatbot
                SET nome=%s,
                    idioma=%s,
                    descricao=%s,
                    cor=%s,
                    mensagem_sem_resposta=%s,
                    greeting_video_text=%s,
                    mensagem_inicial=%s,
                    mensagem_feedback_positiva=%s,
                    mensagem_feedback_negativa=%s,
                    endereco=%s,
                    icon_path=%s,
                    genero=%s,
                    video_enabled=%s
                WHERE chatbot_id=%s
                """,
                (
                    nome,
                    idioma,
                    descricao,
                    cor,
                    mensagem_sem_resposta,
                    greeting_video_text,
                    mensagem_inicial,
                    mensagem_feedback_positiva,
                    mensagem_feedback_negativa,
                    endereco,
                    icon_path,
                    genero,
                    video_enabled,
                    chatbot_id,
                ),
            )
        else:
            cur.execute(
                """
                UPDATE chatbot
                SET nome=%s,
                    idioma=%s,
                    descricao=%s,
                    cor=%s,
                    mensagem_sem_resposta=%s,
                    greeting_video_text=%s,
                    mensagem_inicial=%s,
                    mensagem_feedback_positiva=%s,
                    mensagem_feedback_negativa=%s,
                    endereco=%s,
                    genero=%s,
                    video_enabled=%s
                WHERE chatbot_id=%s
                """,
                (
                    nome,
                    idioma,
                    descricao,
                    cor,
                    mensagem_sem_resposta,
                    greeting_video_text,
                    mensagem_inicial,
                    mensagem_feedback_positiva,
                    mensagem_feedback_negativa,
                    endereco,
                    genero,
                    video_enabled,
                    chatbot_id,
                ),
            )
        if categorias is not None:
            cur.execute("DELETE FROM chatbot_categoria WHERE chatbot_id=%s", (chatbot_id,))
            for categoria_id in categorias:
                cur.execute(
                    "INSERT INTO chatbot_categoria (chatbot_id, categoria_id) VALUES (%s, %s)",
                    (chatbot_id, int(categoria_id))
                )
        cur.execute("SELECT 1 FROM fonte_resposta WHERE chatbot_id=%s", (chatbot_id,))
        if cur.fetchone():
            cur.execute("UPDATE fonte_resposta SET fonte=%s WHERE chatbot_id=%s", (fonte, chatbot_id))
        else:
            cur.execute("INSERT INTO fonte_resposta (chatbot_id, fonte) VALUES (%s, %s)", (chatbot_id, fonte))
        conn.commit()

        # Only regenerate videos when explicitly needed.
        # IMPORTANT: Do NOT regenerate if only descricao, cor, mensagem_sem_resposta, fonte, or categorias changed.
        video_queued = False
        video_busy = False
        if video_enabled:
            was_video_enabled = bool(old_video_enabled)

            nome_changed = (old_nome or "").strip() != (nome or "").strip()
            icon_changed = bool(new_icon_uploaded)
            genero_changed = (old_genero or "").strip() != (genero or "").strip()
            idioma_changed = (old_idioma or "pt").strip().lower()[:2] != (idioma or "pt").strip().lower()[:2]
            greeting_text_changed = (old_greeting_text or "").strip() != (greeting_video_text or "").strip()
            msg_no_answer_changed = (old_msg_no_answer or "").strip() != (mensagem_sem_resposta or "").strip()
            msg_pos_changed = (old_msg_pos or "").strip() != (mensagem_feedback_positiva or "").strip()
            msg_neg_changed = (old_msg_neg or "").strip() != (mensagem_feedback_negativa or "").strip()
            ai_notice_changed = (old_ai_notice or "").strip() != (mensagem_gerada_ai or "").strip()

            # Only queue if video was just enabled OR one of the video-relevant fields changed.
            should_queue = (
                (not was_video_enabled)
                or nome_changed
                or icon_changed
                or genero_changed
                or idioma_changed
                or greeting_text_changed
                or msg_no_answer_changed
                or msg_pos_changed
                or msg_neg_changed
            )

            kinds_needed = []
            if should_queue:
                if (not was_video_enabled) or nome_changed or icon_changed or genero_changed or idioma_changed:
                    kinds_needed = ["greeting", "idle", "positive", "negative", "no_answer"]
                else:
                    if greeting_text_changed:
                        kinds_needed.append("greeting")
                    if msg_pos_changed:
                        kinds_needed.append("positive")
                    if msg_neg_changed:
                        kinds_needed.append("negative")
                    if msg_no_answer_changed:
                        kinds_needed.append("no_answer")

            # Backwards-compatible behavior:
            # - if regen_videos is not provided: auto-queue when needed
            # - if regen_videos is explicitly false: never queue
            # - if regen_videos is true: queue only requested/needed kinds
            should_queue_now = False
            if should_queue and regen_videos is None:
                should_queue_now = True
            elif should_queue and regen_videos is True:
                should_queue_now = True
            elif regen_videos is False:
                should_queue_now = False

            if should_queue_now and kinds_needed:
                kinds_to_generate = kinds_needed
                if requested_video_kinds is not None:
                    allowed = {k.lower() for k in kinds_needed}
                    req = {str(k).strip().lower() for k in requested_video_kinds if str(k).strip()}
                    chosen = [k for k in kinds_needed if k.lower() in allowed.intersection(req)]
                    if chosen:
                        kinds_to_generate = chosen

                from ..services.video_service import queue_videos_for_chatbot

                video_queued = bool(queue_videos_for_chatbot(chatbot_id, kinds=kinds_to_generate))
                video_busy = not video_queued

        payload = {
            "success": True,
            "video_enabled": bool(video_enabled),
            "video_queued": bool(video_queued),
            "video_busy": bool(video_busy),
            "idioma": idioma,
        }
        if video_busy:
            payload["error"] = (
                "Já existe um vídeo a ser gerado neste momento. "
                "A geração de vídeos deste chatbot terá de ser iniciada mais tarde."
            )
        return jsonify(payload)
    except Exception as e:
        conn.rollback()
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/chatbots/<int:chatbot_id>", methods=["DELETE"])
def eliminar_chatbot(chatbot_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        # Fetch icon and active flag before deleting the row (so we can remove the file from disk)
        cur.execute("SELECT icon_path, ativo FROM chatbot WHERE chatbot_id = %s", (chatbot_id,))
        row = cur.fetchone()
        icon_path = row[0] if row else None
        was_active = bool(row[1]) if row and len(row) > 1 else False

        # Fetch FAQ IDs before deleting to clean up their video files
        cur.execute("SELECT faq_id FROM faq WHERE chatbot_id = %s", (chatbot_id,))
        faq_ids = [row[0] for row in cur.fetchall()]
        
        cur.execute("DELETE FROM faq_relacionadas WHERE faq_id IN (SELECT faq_id FROM faq WHERE chatbot_id = %s)", (chatbot_id,))
        cur.execute("DELETE FROM faq_documento WHERE faq_id IN (SELECT faq_id FROM faq WHERE chatbot_id = %s)", (chatbot_id,))
        cur.execute("DELETE FROM faq WHERE chatbot_id = %s", (chatbot_id,))
        cur.execute("DELETE FROM fonte_resposta WHERE chatbot_id = %s", (chatbot_id,))
        cur.execute("DELETE FROM pdf_documents WHERE chatbot_id = %s", (chatbot_id,))
        cur.execute("DELETE FROM chatbot WHERE chatbot_id = %s", (chatbot_id,))
        conn.commit()
        build_faiss_index()

        # If we deleted the active chatbot, promote another one to active (best-effort)
        if was_active:
            try:
                cur.execute("SELECT chatbot_id FROM chatbot ORDER BY chatbot_id ASC LIMIT 1")
                r = cur.fetchone()
                if r:
                    cur.execute("UPDATE chatbot SET ativo = FALSE WHERE ativo = TRUE")
                    cur.execute("UPDATE chatbot SET ativo = TRUE, publicado = TRUE WHERE chatbot_id = %s", (r[0],))
                    conn.commit()
            except Exception:
                conn.rollback()
        
        # Clean up FAQ video files (now stored in chatbot_{id}/faq_{faq_id}/)
        try:
            from ..services.video_service import ROOT, RESULTS_DIR
            import shutil
            result_root = RESULTS_DIR if RESULTS_DIR.is_absolute() else (ROOT / RESULTS_DIR)
            chatbot_dir = result_root / f"chatbot_{chatbot_id}"
            for faq_id in faq_ids:
                # New location: chatbot_{id}/faq_{faq_id}/
                faq_dir = chatbot_dir / f"faq_{faq_id}"
                if faq_dir.exists() and faq_dir.is_dir():
                    shutil.rmtree(faq_dir, ignore_errors=True)
                # Also try legacy location for backwards compatibility
                legacy_dir = result_root / f"faq_{faq_id}"
                if legacy_dir.exists() and legacy_dir.is_dir():
                    shutil.rmtree(legacy_dir, ignore_errors=True)
        except Exception:
            pass
        
        _cleanup_chatbot_files(chatbot_id, icon_path=icon_path)
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()

@app.route("/fonte/<int:chatbot_id>", methods=["GET"])
def obter_fonte_chatbot(chatbot_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT fonte FROM fonte_resposta WHERE chatbot_id = %s", (chatbot_id,))
        row = cur.fetchone()
        if row:
            fonte = row[0] if row[0] else "faq"
            return jsonify({"success": True, "fonte": fonte})
        return jsonify({"success": False, "erro": "Chatbot não encontrado."}), 404
    except Exception as e:
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/fonte", methods=["POST"])
def definir_fonte_chatbot():
    conn = get_conn()
    cur = conn.cursor()
    data = request.get_json()
    chatbot_id = data.get("chatbot_id")
    fonte = data.get("fonte")
    if fonte not in ["faq", "faiss", "faq+raga"]:
        return jsonify({"success": False, "erro": "Fonte inválida."}), 400
    try:
        cur.execute("SELECT 1 FROM fonte_resposta WHERE chatbot_id = %s", (chatbot_id,))
        if not cur.fetchone():
            cur.execute("INSERT INTO fonte_resposta (chatbot_id, fonte) VALUES (%s, %s)", (chatbot_id, fonte))
        else:
            cur.execute("UPDATE fonte_resposta SET fonte = %s WHERE chatbot_id = %s", (fonte, chatbot_id))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/chatbots/<int:chatbot_id>/categorias", methods=["GET"])
def get_categorias_chatbot(chatbot_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT c.categoria_id, c.nome
            FROM categoria c
            JOIN chatbot_categoria cc ON c.categoria_id = cc.categoria_id
            WHERE cc.chatbot_id = %s
        """, (chatbot_id,))
        data = cur.fetchall()
        return jsonify([{"categoria_id": c[0], "nome": c[1]} for c in data])
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/chatbots/<int:chatbot_id>/categorias/<int:categoria_id>", methods=["DELETE"])
def remove_categoria_from_chatbot(chatbot_id, categoria_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM chatbot_categoria WHERE chatbot_id = %s AND categoria_id = %s", (chatbot_id, categoria_id))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()

@app.route("/chatbots/<int:chatbot_id>/categorias", methods=["POST"])
def add_categoria_to_chatbot(chatbot_id):
    conn = get_conn()
    cur = conn.cursor()
    data = request.get_json()
    categoria_id = data.get("categoria_id")
    if not categoria_id:
        return jsonify({"success": False, "error": "ID da categoria é obrigatório."}), 400
    try:
        cur.execute("INSERT INTO chatbot_categoria (chatbot_id, categoria_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (chatbot_id, categoria_id))
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

