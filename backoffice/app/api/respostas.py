from flask import Blueprint, request, jsonify
from flask import url_for
from ..db import get_conn
from ..services.text import detectar_saudacao, registar_pergunta_nao_respondida, normalizar_idioma
from ..services.retreival import obter_faq_mais_semelhante, pesquisar_faiss, build_faiss_index
from ..services.rag import pesquisar_pdf_pgvector, obter_mensagem_sem_resposta
import traceback
import re
import unicodedata

app = Blueprint('respostas', __name__)


STOPWORDS_FAQ = {
    "como", "posso", "pode", "para", "uma", "um", "uns", "umas",
    "que", "qual", "quais", "onde", "quando", "tenho", "devo",
    "fazer", "pedir", "pedido", "preciso", "necessario", "necessaria",
    "o", "a", "os", "as", "de", "da", "do", "das", "dos", "em",
    "no", "na", "nos", "nas", "por", "com", "ao", "aos", "me", "minha",
    "meu", "se", "e"
}


def normalizar_texto_faq(texto):
    texto = str(texto or "").lower()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def extrair_termos_faq(texto):
    texto_norm = normalizar_texto_faq(texto)

    termos = {
        termo for termo in texto_norm.split()
        if len(termo) >= 3 and termo not in STOPWORDS_FAQ
    }

    expandidos = set(termos)

    for termo in list(termos):
        if termo.startswith("renov"):
            expandidos.update({
                "renovar", "renovacao", "renovo",
                "caducidade", "caducar", "validade"
            })

        if termo in {"licenca", "licencas"}:
            expandidos.update({
                "licenca", "licencas", "autorizacao", "permissao"
            })

        if termo in {"autorizacao", "autorizar", "autorizacoes"}:
            expandidos.update({
                "licenca", "autorizacao", "permissao"
            })

        if termo in {"camara", "municipio", "autarquia"}:
            expandidos.update({
                "camara", "municipio", "autarquia"
            })

        if termo in {"rua", "via", "passeio"}:
            expandidos.update({
                "rua", "via", "publica", "espaco", "publico", "passeio"
            })

        if termo in {"espaco", "publico", "publica"}:
            expandidos.update({
                "espaco", "publico", "publica", "via", "rua"
            })

        if termo in {"donativo", "donativos", "peditorio", "peditorios"}:
            expandidos.update({
                "donativo", "donativos", "peditorio",
                "peditorios", "angariar", "fundos"
            })

        if termo in {"acabar", "caducar", "caducidade", "validade"}:
            expandidos.update({
                "renovar", "renovacao", "licenca",
                "caducidade", "validade"
            })

        if termo in {"contacto", "contactos", "telefone", "email", "morada", "horario"}:
            expandidos.update({
                "contacto", "contactos", "telefone",
                "email", "morada", "horario", "atendimento"
            })

    return expandidos


def procurar_faqs_relacionadas(cur, pergunta, chatbot_id, idioma="pt", limite=5):
    termos_pergunta = extrair_termos_faq(pergunta)

    if not termos_pergunta:
        return []

    cur.execute("""
        SELECT faq_id, pergunta
        FROM faq
        WHERE chatbot_id = %s AND idioma = %s
    """, (chatbot_id, idioma))

    faqs = cur.fetchall()
    resultados = []

    pergunta_norm = normalizar_texto_faq(pergunta)

    for faq_id, pergunta_faq in faqs:
        pergunta_faq_norm = normalizar_texto_faq(pergunta_faq)
        termos_faq = extrair_termos_faq(pergunta_faq)

        comuns = termos_pergunta.intersection(termos_faq)
        score = len(comuns) * 10

        for termo in termos_pergunta:
            if termo in pergunta_faq_norm:
                score += 2

        if pergunta_norm and pergunta_norm in pergunta_faq_norm:
            score += 15

        if score > 0:
            resultados.append({
                "faq_id": faq_id,
                "pergunta": pergunta_faq,
                "score": score
            })

    resultados.sort(key=lambda item: item["score"], reverse=True)

    vistos = set()
    unicos = []

    for resultado in resultados:
        chave = normalizar_texto_faq(resultado["pergunta"])

        if chave not in vistos:
            vistos.add(chave)
            unicos.append(resultado)

    return unicos[:limite]

@app.route("/obter-resposta", methods=["POST"])
def obter_resposta():
    conn = get_conn()
    cur = conn.cursor()
    try:
        dados = request.get_json()
        pergunta = dados.get("pergunta", "").strip()
        chatbot_id = dados.get("chatbot_id")
        fonte = dados.get("fonte", "faq")
        idioma = normalizar_idioma(dados.get("idioma", "pt"))
        feedback = dados.get("feedback", None)
        print("DEBUG /obter-resposta:", {
            "pergunta": pergunta,
            "chatbot_id": chatbot_id,
            "fonte": fonte,
            "feedback": feedback,
            "type_feedback": type(feedback)
        })
        try:
            chatbot_id = int(chatbot_id)
        except Exception:
            return jsonify({"success": False, "erro": "Chatbot ID invÃ¡lido."}), 400
        saudacao = detectar_saudacao(pergunta)
        if saudacao:
            return jsonify({
                "success": True,
                "fonte": "SAUDACAO",
                "resposta": saudacao,
                "faq_id": None,
                "categoria_id": None,
                "pergunta_faq": None,
                "documentos": []
            })
        if not pergunta or (len(pergunta) < 4 and not any(char.isalpha() for char in pergunta)):
            return jsonify({
                "success": False,
                "erro": "Pergunta demasiado curta ou nÃ£o reconhecida como vÃ¡lida."
            })
        if fonte == "faq+raga" and (feedback is None or feedback == "") and pergunta.lower() in ["sim", "yes"]:
            return jsonify({
                "success": False,
                "erro": "Por favor utilize os botÃµes abaixo para confirmar.",
                "prompt_rag": True
            })
        try:
            if fonte == "faq":
                resultado = obter_faq_mais_semelhante(pergunta, chatbot_id, idioma=idioma)
                if resultado:
                    cur.execute("""
                        SELECT faq_id, categoria_id, video_status FROM faq
                        WHERE LOWER(pergunta) = LOWER(%s) AND chatbot_id = %s AND idioma = %s
                    """, (resultado["pergunta"], chatbot_id, idioma))
                    row = cur.fetchone()
                    faq_id, categoria_id, video_status = row if row else (None, None, None)

                    # Se o chatbot tiver vÃ­deo ativo e o vÃ­deo ainda nÃ£o estiver pronto, tentar enfileirar.
                    video_enabled = False
                    try:
                        cur.execute("SELECT video_enabled FROM chatbot WHERE chatbot_id = %s", (chatbot_id,))
                        r = cur.fetchone()
                        video_enabled = bool(r[0]) if r else False
                    except Exception:
                        video_enabled = False

                    # IMPORTANT: nÃ£o gerar vÃ­deo automaticamente ao usar a FAQ no chat.
                    # A geraÃ§Ã£o deve ser manual (backoffice) e o chat apenas reflete estados.
                    video_queued = False
                    video_busy = False

                    cur.execute("SELECT link FROM faq_documento WHERE faq_id = %s", (faq_id,))
                    docs = [r[0] for r in cur.fetchall()]
                    return jsonify({
                        "success": True,
                        "fonte": "FAQ",
                        "resposta": resultado["resposta"],
                        "faq_id": faq_id,
                        "faq_idioma": idioma,
                        "categoria_id": categoria_id,
                        "video_status": video_status,
                        "video_enabled": video_enabled,
                        "video_queued": video_queued,
                        "video_busy": video_busy,
                        "score": resultado["score"],
                        "pergunta_faq": resultado["pergunta"],
                        "documentos": docs
                    })
                sugestoes = procurar_faqs_relacionadas(cur, pergunta, chatbot_id, idioma=idioma)

                registar_pergunta_nao_respondida(chatbot_id, pergunta, "faq")
                return jsonify({
                "success": False,
                "erro": obter_mensagem_sem_resposta(chatbot_id),
                "no_answer": True,
                "prompt_rag": True,
                "sugestoes_faq": sugestoes
                })
            elif fonte == "faiss":
                faiss_resultados = pesquisar_faiss(
                    pergunta,
                    chatbot_id=chatbot_id,
                    idioma=idioma,
                    k=3,
                    min_sim=0.6,
                    relax_min_sim=0.5,
                )
                if faiss_resultados:
                    faq_id = faiss_resultados[0]['faq_id']
                    cur.execute("SELECT link FROM faq_documento WHERE faq_id = %s", (faq_id,))
                    docs = [r[0] for r in cur.fetchall()]
                    return jsonify({
                        "success": True,
                        "fonte": "FAISS",
                        "resposta": faiss_resultados[0]['resposta'],
                        "faq_id": faq_id,
                        "faq_idioma": idioma,
                        "score": faiss_resultados[0]['score'],
                        "pergunta_faq": faiss_resultados[0]['pergunta'],
                        "documentos": docs
                    })
                else:
                    resultado = obter_faq_mais_semelhante(pergunta, chatbot_id, idioma=idioma, threshold=75)
                    if resultado:
                        cur.execute("""
                            SELECT faq_id, categoria_id, video_status FROM faq
                            WHERE LOWER(pergunta) = LOWER(%s) AND chatbot_id = %s AND idioma = %s
                        """, (resultado["pergunta"], chatbot_id, idioma))
                        row = cur.fetchone()
                        faq_id, categoria_id, video_status = row if row else (None, None, None)
                        cur.execute("SELECT link FROM faq_documento WHERE faq_id = %s", (faq_id,))
                        docs = [r[0] for r in cur.fetchall()]
                        return jsonify({
                            "success": True,
                            "fonte": "FUZZY",
                            "resposta": resultado["resposta"],
                            "faq_id": faq_id,
                            "faq_idioma": idioma,
                            "categoria_id": categoria_id,
                            "video_status": video_status,
                            "score": resultado["score"],
                            "pergunta_faq": resultado["pergunta"],
                            "documentos": docs
                        })
                    return jsonify({
                        "success": False,
                        "erro": "NÃ£o encontrei nenhuma resposta suficientemente semelhante na base de dados."
                    })
            elif fonte == "faq+raga":
                resultado = obter_faq_mais_semelhante(pergunta, chatbot_id, idioma=idioma)
                if resultado:
                    cur.execute("""
                        SELECT faq_id, categoria_id, video_status FROM faq
                        WHERE LOWER(pergunta) = LOWER(%s) AND chatbot_id = %s AND idioma = %s
                    """, (resultado["pergunta"], chatbot_id, idioma))
                    row = cur.fetchone()
                    faq_id, categoria_id, video_status = row if row else (None, None, None)
                    cur.execute("SELECT link FROM faq_documento WHERE faq_id = %s", (faq_id,))
                    docs = [r[0] for r in cur.fetchall()]
                    return jsonify({
                        "success": True,
                        "fonte": "FAQ",
                        "resposta": resultado["resposta"],
                        "faq_id": faq_id,
                        "faq_idioma": idioma,
                        "categoria_id": categoria_id,
                        "video_status": video_status,
                        "score": resultado["score"],
                        "pergunta_faq": resultado["pergunta"],
                        "documentos": docs
                    })
                elif feedback and feedback.strip().lower() == "try_rag":
                    print("DEBUG: A tentar responder via RAG (PDF) via pgvector")
                    resposta_rag, fontes = pesquisar_pdf_pgvector(pergunta, chatbot_id=chatbot_id)
                    if resposta_rag:
                        # Optional AI warning message configured per chatbot
                        ai_notice = ""
                        try:
                            cur.execute(
                                "SELECT mensagem_gerada_ai FROM chatbot WHERE chatbot_id = %s",
                                (chatbot_id,),
                            )
                            r = cur.fetchone()
                            ai_notice = (r[0] or "").strip() if r else ""
                        except Exception:
                            ai_notice = ""
                        pdf_ids = []
                        for f in fontes:
                            if f["pdf_id"] not in pdf_ids:
                                pdf_ids.append(f["pdf_id"])
                        return jsonify({
                            "success": True,
                            "fonte": "RAG-PGVECTOR",
                            "resposta": resposta_rag,
                            "ai_generated": True,
                            "ai_notice": ai_notice,
                            "faq_id": None,
                            "categoria_id": None,
                            "score": None,
                            "pergunta_faq": None,
                            # Return URLs that are valid behind reverse-proxy (avoid leaking server paths)
                            "documentos": [url_for("api.uploads.get_pdf", pdf_id=pid) for pid in pdf_ids]
                        })
                    else:
                        return jsonify({
                            "success": False,
                            "erro": "Nao foi possivel encontrar uma resposta nos documentos PDF."
                        })
                else:
                    print("DEBUG: feedback != 'try_rag' -> devolve prompt_rag com sugestões")
                    sugestoes = procurar_faqs_relacionadas(cur, pergunta, chatbot_id, idioma=idioma)

                    return jsonify({
                    "success": False,
                    "erro": "Pergunta não encontrada nas FAQs. Deseja tentar encontrar uma resposta nos documentos PDF? Isso pode levar alguns segundos.",
                    "prompt_rag": True,
                    "sugestoes_faq": sugestoes
                    })
            else:
                return jsonify({"success": False, "erro": "Fonte inválida."}), 400
        except Exception as inner_e:
            print(traceback.format_exc())
            return jsonify({"success": False, "erro": str(inner_e)}), 500
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        try:
            cur.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass

@app.route("/perguntas-semelhantes", methods=["POST"])
def perguntas_semelhantes():
    conn = get_conn()
    cur = conn.cursor()
    dados = request.get_json()
    pergunta_atual = dados.get("pergunta", "")
    chatbot_id = dados.get("chatbot_id")
    idioma = dados.get("idioma", "pt")
    try:
        cur.execute("""
            SELECT categoria_id
            FROM faq
            WHERE LOWER(pergunta) = LOWER(%s) AND chatbot_id = %s AND idioma = %s
        """, (pergunta_atual.strip().lower(), chatbot_id, idioma))
        categoria_row = cur.fetchone()
        if not categoria_row or categoria_row[0] is None:
            return jsonify({"success": True, "sugestoes": []})
        categoria_id = categoria_row[0]
        cur.execute("""
            SELECT pergunta
            FROM faq
            WHERE categoria_id = %s
              AND recomendado = TRUE
              AND LOWER(pergunta) != LOWER(%s)
              AND chatbot_id = %s
              AND idioma = %s
            ORDER BY RANDOM()
            LIMIT 2
        """, (categoria_id, pergunta_atual.strip().lower(), chatbot_id, idioma))
        sugestoes = [row[0] for row in cur.fetchall()]
        return jsonify({"success": True, "sugestoes": sugestoes})
    except Exception as e:
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/faqs-aleatorias", methods=["POST"])
def faqs_aleatorias():
    conn = get_conn()
    cur = conn.cursor()
    dados = request.get_json()
    idioma = dados.get("idioma", "pt")
    n = int(dados.get("n", 3))
    chatbot_id = dados.get("chatbot_id")
    try:
        if chatbot_id:
            cur.execute("""
                SELECT pergunta
                FROM faq
                WHERE idioma = %s AND chatbot_id = %s
                ORDER BY RANDOM()
                LIMIT %s
            """, (idioma, chatbot_id, n))
        else:
            cur.execute("""
                SELECT pergunta
                FROM faq
                WHERE idioma = %s
                ORDER BY RANDOM()
                LIMIT %s
            """, (idioma, n))
        faqs = [row[0] for row in cur.fetchall()]
        return jsonify({"success": True, "faqs": [{"pergunta": p} for p in faqs]})
    except Exception as e:
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/rebuild-faiss", methods=["POST"])
def rebuild_faiss():
    build_faiss_index()
    return jsonify({"success": True, "msg": "FAISS index rebuilt."})

@app.route("/faq-categoria/<categoria>", methods=["GET"])
def obter_faq_por_categoria(categoria):
    conn = get_conn()
    cur = conn.cursor()
    try:
        chatbot_id = request.args.get("chatbot_id")
        if not chatbot_id:
            return jsonify({"success": False, "erro": "chatbot_id nÃ£o fornecido."}), 400
        cur.execute("""
            SELECT f.faq_id, f.pergunta, f.resposta
            FROM faq f
            INNER JOIN categoria c ON f.categoria_id = c.categoria_id
            WHERE LOWER(c.nome) = LOWER(%s) AND f.chatbot_id = %s
            ORDER BY RANDOM()
            LIMIT 1
        """, (categoria, chatbot_id))
        resultado = cur.fetchone()
        if resultado:
            return jsonify({
                "success": True,
                "faq_id": resultado[0],
                "pergunta": resultado[1],
                "resposta": resultado[2]
            })
        else:
            return jsonify({
                "success": False,
                "erro": f"Nenhuma FAQ encontrada para a categoria '{categoria}'."
            }), 404
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/perguntas-nao-respondidas", methods=["GET"])
def nao_respondidas():
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id,
                   chatbot_id,
                   pergunta,
                   fonte,
                   max_score,
                   estado,
                   criado_em
            FROM perguntanaorespondida
            ORDER BY criado_em DESC
        """)
        rows = cur.fetchall()

        data = [
            {
                "id": row[0],
                "chatbot_id": row[1],
                "pergunta": row[2],
                "fonte": row[3],
                "max_score": row[4],
                "estado": row[5],
                "criado_em": row[6],  
            }
            for row in rows
        ]

        return jsonify(data)
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/perguntas-nao-respondidas/metricas", methods=["GET"])
def metricas_nao_respondidas():
    """
    Devolve contagens agregadas de perguntas nÃ£o respondidas por chatbot,
    separadas por estado e incluindo o Ãºltimo registo.
    """
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT
                c.chatbot_id,
                c.nome,
                COALESCE(p.total, 0) AS total,
                COALESCE(p.pendentes, 0) AS pendentes,
                COALESCE(p.tratadas, 0) AS tratadas,
                COALESCE(p.ignoradas, 0) AS ignoradas,
                p.ultimo_registo
                FROM chatbot c
            LEFT JOIN (
                SELECT
                    chatbot_id,
                    COUNT(*) AS total,
                    SUM(CASE WHEN LOWER(estado) = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
                    SUM(CASE WHEN LOWER(estado) = 'tratada' THEN 1 ELSE 0 END) AS tratadas,
                    SUM(CASE WHEN LOWER(estado) = 'ignorada' THEN 1 ELSE 0 END) AS ignoradas,
                    MAX(criado_em) AS ultimo_registo
                FROM perguntanaorespondida
                GROUP BY chatbot_id
            ) p ON p.chatbot_id = c.chatbot_id
            ORDER BY total DESC, c.nome ASC
        """)
        rows = cur.fetchall()
        data = [
            {
                "chatbot_id": row[0],
                "nome": row[1],
                "total": row[2],
                "pendentes": row[3],
                "tratadas": row[4],
                "ignoradas": row[5],
                "ultimo_registo": row[6],
            }
            for row in rows
        ]
        return jsonify({"success": True, "metricas": data})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "erro": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/perguntas-nao-respondidas/<int:pergunta_id>", methods=["DELETE"]) 
def delete_pergunta_nao_respondida(pergunta_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM perguntanaorespondida WHERE id = %s", (pergunta_id,))
        if cur.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Pergunta nao encontrada."}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route("/perguntas-nao-respondidas/<int:pergunta_id>", methods=["PUT"])
def update_pergunta_nao_respondida(pergunta_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        dados = request.get_json(silent=True) or {}
        novo_estado = (dados.get("estado") or "tratada").strip().lower()

        estados_validos = {"pendente", "tratada", "ignorada"}
        if novo_estado not in estados_validos:
            return jsonify({"success": False, "error": "Estado invalido."}), 400

        cur.execute(
            "UPDATE perguntanaorespondida SET estado = %s WHERE id = %s",
            (novo_estado, pergunta_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Pergunta nao encontrada."}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        cur.close()
        conn.close()      
