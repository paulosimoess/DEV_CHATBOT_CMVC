from ..db import get_conn
from sentence_transformers import SentenceTransformer
import numpy as np
import faiss
import pickle
import logging
from ..config import Config
import os
from .text import preprocess_text
import re
import unicodedata

embedding_model = SentenceTransformer('all-MiniLM-L12-v2')
PDF_STORAGE_PATH = Config.PDF_STORAGE_PATH
ICON_STORAGE_PATH = Config.ICON_STORAGE_PATH
os.makedirs(PDF_STORAGE_PATH, exist_ok=True)
os.makedirs(ICON_STORAGE_PATH, exist_ok=True)


def _faq_to_embedding_text(pergunta, resposta):
    # Use question + answer to improve recall on varied user phrasing.
    combined = f"{pergunta}\n{resposta}"
    return preprocess_text(combined)


def build_faiss_index(chatbot_id=None):
    conn = get_conn()
    cur = conn.cursor()
    try:
        if chatbot_id:
            cur.execute(
                "SELECT faq_id, pergunta, resposta, chatbot_id, idioma FROM faq WHERE chatbot_id = %s",
                (chatbot_id,),
            )
        else:
            cur.execute("SELECT faq_id, pergunta, resposta, chatbot_id, idioma FROM faq")
        faqs = cur.fetchall()
        textos = [_faq_to_embedding_text(f[1], f[2]) for f in faqs]
        if not textos:
            emb_dim = embedding_model.get_sentence_embedding_dimension()
            embeddings = np.zeros((1, emb_dim), dtype=np.float32)
            index = faiss.IndexFlatIP(emb_dim)
        else:
            embeddings = embedding_model.encode(textos, show_progress_bar=True)
            embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
            index = faiss.IndexFlatIP(embeddings.shape[1])
            index.add(np.array(embeddings, dtype=np.float32))
        with open(Config.FAQ_EMBEDDINGS_PATH, 'wb') as f:
            pickle.dump({'faqs': faqs, 'embeddings': embeddings}, f)
        faiss.write_index(index, Config.INDEX_PATH)
        logging.info(f"Índice FAISS para FAQs salvo em {Config.INDEX_PATH}")
    except Exception as e:
        logging.error(f"Erro ao construir índice FAISS para FAQs: {e}")
        raise
    finally:
        cur.close()

def load_faiss_index():
    try:
        if not os.path.exists(Config.INDEX_PATH) or not os.path.exists(Config.FAQ_EMBEDDINGS_PATH):
            logging.info("Índice FAISS ou embeddings de FAQs não encontrados. Reconstruindo...")
            build_faiss_index()
        index = faiss.read_index(Config.INDEX_PATH)
        with open(Config.FAQ_EMBEDDINGS_PATH, 'rb') as f:
            data = pickle.load(f)
        return index, data['faqs'], data['embeddings']
    except Exception as e:
        logging.error(f"Erro ao carregar índice FAISS para FAQs: {e}")
        logging.info("Reconstruindo índice FAISS para FAQs...")
        build_faiss_index()
        index = faiss.read_index(Config.INDEX_PATH)
        with open(Config.FAQ_EMBEDDINGS_PATH, 'rb') as f:
            data = pickle.load(f)
        return index, data['faqs'], data['embeddings']

faiss_index, faqs_db, faq_embeddings = load_faiss_index()

def pesquisar_faiss(pergunta, chatbot_id=None, idioma=None, k=1, min_sim=0.7, relax_min_sim=None):
    pergunta = preprocess_text(pergunta)
    results = []
    if len(faqs_db) == 0:
        return []

    idioma_norm = (idioma or "").strip().lower()[:2] if idioma else None
    if idioma_norm and idioma_norm not in {"pt", "en"}:
        idioma_norm = None

    query_emb = embedding_model.encode([pergunta])
    query_emb = query_emb / np.linalg.norm(query_emb, axis=1, keepdims=True)

    max_results = len(faqs_db)
    target_k = max(k, 1)
    n = min(max(target_k * 5, 10), max_results)
    seen = set()

    while True:
        D, I = faiss_index.search(np.array(query_emb, dtype=np.float32), n)
        for score, idx_faq in zip(D[0], I[0]):
            if idx_faq == -1 or idx_faq in seen:
                continue
            seen.add(idx_faq)
            if score < min_sim:
                continue
            row = faqs_db[idx_faq]
            if row is None:
                continue
            # Backwards compatibility: old cache may not have idioma
            if len(row) >= 5:
                faq_id, pergunta_faq, resposta_faq, chatbot_id_faq, faq_idioma = row[:5]
            else:
                faq_id, pergunta_faq, resposta_faq, chatbot_id_faq = row[:4]
                faq_idioma = None
            if chatbot_id and int(chatbot_id_faq) != int(chatbot_id):
                continue
            if idioma_norm and (faq_idioma or "").strip().lower()[:2] != idioma_norm:
                continue
            results.append({
                'faq_id': faq_id,
                'pergunta': pergunta_faq,
                'resposta': resposta_faq,
                'score': float(score)
            })
            if len(results) >= target_k:
                break
        if len(results) >= target_k or n >= max_results:
            break
        n = min(n * 2, max_results)

    if not results and relax_min_sim is not None and relax_min_sim < min_sim:
        # Relax threshold with the same FAISS candidates before returning empty.
        D, I = faiss_index.search(np.array(query_emb, dtype=np.float32), n)
        for score, idx_faq in zip(D[0], I[0]):
            if idx_faq == -1 or score < relax_min_sim:
                continue
            row = faqs_db[idx_faq]
            if row is None:
                continue
            if len(row) >= 5:
                faq_id, pergunta_faq, resposta_faq, chatbot_id_faq, faq_idioma = row[:5]
            else:
                faq_id, pergunta_faq, resposta_faq, chatbot_id_faq = row[:4]
                faq_idioma = None
            if chatbot_id and int(chatbot_id_faq) != int(chatbot_id):
                continue
            if idioma_norm and (faq_idioma or "").strip().lower()[:2] != idioma_norm:
                continue
            results.append({
                'faq_id': faq_id,
                'pergunta': pergunta_faq,
                'resposta': resposta_faq,
                'score': float(score)
            })
            if len(results) >= target_k:
                break

    return results
    
def get_faqs_from_db(chatbot_id=None, idioma=None):
    conn = get_conn()
    cur = conn.cursor()
    try:
        idioma_norm = (idioma or "").strip().lower()[:2] if idioma else None
        if chatbot_id and idioma_norm:
            cur.execute(
                "SELECT faq_id, pergunta, resposta, chatbot_id, idioma FROM faq WHERE chatbot_id = %s AND idioma = %s",
                (chatbot_id, idioma_norm),
            )
        elif chatbot_id:
            cur.execute(
                "SELECT faq_id, pergunta, resposta, chatbot_id, idioma FROM faq WHERE chatbot_id = %s",
                (chatbot_id,),
            )
        else:
            cur.execute("SELECT faq_id, pergunta, resposta, chatbot_id, idioma FROM faq")
        return cur.fetchall()
    finally:
        cur.close()

STOPWORDS_MATCH = {
    "como", "posso", "pode", "para", "uma", "um", "uns", "umas",
    "que", "qual", "quais", "onde", "quando", "tenho", "devo",
    "fazer", "pedir", "pedido", "preciso", "necessario", "necessaria",
    "o", "a", "os", "as", "de", "da", "do", "das", "dos", "em",
    "no", "na", "nos", "nas", "por", "com", "ao", "aos", "me", "minha",
    "meu", "se", "e"
}

TERMOS_GENERICOS_MATCH = {
    "licenca", "licencas", "autorizacao", "autorizacoes",
    "permissao", "permissoes", "pedido", "pedidos", "municipal"
}


def normalizar_texto_match(texto):
    texto = str(texto or "").lower()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def extrair_termos_match(texto):
    texto_norm = normalizar_texto_match(texto)

    termos = {
        termo for termo in texto_norm.split()
        if len(termo) >= 3 and termo not in STOPWORDS_MATCH
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

        if termo in {"angariar", "fundos"}:
            expandidos.update({
                "donativo", "donativos", "peditorio", "peditorios",
                "angariar", "fundos"
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

        if termo in {"camara", "municipio", "autarquia"}:
            expandidos.update({
                "camara", "municipio", "autarquia"
            })

    return expandidos


def tem_relacao_semantica_forte(pergunta_utilizador, texto_faq):
    termos_pergunta = extrair_termos_match(pergunta_utilizador)
    termos_faq = extrair_termos_match(texto_faq)

    comuns = termos_pergunta.intersection(termos_faq)

    termos_fortes = {
        termo for termo in comuns
        if termo not in TERMOS_GENERICOS_MATCH
    }

    return len(termos_fortes) > 0

def obter_faq_mais_semelhante(pergunta, chatbot_id, idioma=None, threshold=70):
    from rapidfuzz import fuzz
    from .text import preprocess_text_for_matching

    conn = get_conn()
    cur = conn.cursor()

    try:
        idioma_norm = (idioma or "").strip().lower()[:2] if idioma else None

        if idioma_norm and idioma_norm in {"pt", "en"}:
            cur.execute(
                """
                SELECT faq_id, pergunta, resposta, designacao, serve_text
                FROM faq
                WHERE chatbot_id = %s AND idioma = %s
                """,
                (chatbot_id, idioma_norm),
            )
        else:
            cur.execute(
                """
                SELECT faq_id, pergunta, resposta, designacao, serve_text
                FROM faq
                WHERE chatbot_id = %s
                """,
                (chatbot_id,),
            )

        faqs = cur.fetchall()

        if not faqs:
            return None

        pergunta_processed = preprocess_text_for_matching(pergunta)
        pergunta_norm = normalizar_texto_match(pergunta)

        melhor_score = 0
        melhor_faq = None

        for faq_id, pergunta_faq, resposta, designacao, serve_text in faqs:
            pergunta_faq_norm = normalizar_texto_match(pergunta_faq)
            designacao_norm = normalizar_texto_match(designacao)

            # Correspondência exata:
            # se o utilizador clicar numa sugestão ou escrever exatamente
            # a pergunta/designação da FAQ, devolver imediatamente essa FAQ.
            if pergunta_norm and (
                pergunta_norm == pergunta_faq_norm
                or pergunta_norm == designacao_norm
            ):
                return {
                    "faq_id": faq_id,
                    "pergunta": pergunta_faq,
                    "resposta": resposta,
                    "score": 100,
                }

            candidatos = [
                pergunta_faq or "",
                designacao or "",
                serve_text or "",
            ]

            scores = []

            for candidato in candidatos:
                candidato_processed = preprocess_text_for_matching(candidato)

                if not candidato_processed:
                    continue

                score = max(
                    fuzz.ratio(pergunta_processed, candidato_processed),
                    fuzz.token_set_ratio(pergunta_processed, candidato_processed),
                    fuzz.partial_ratio(pergunta_processed, candidato_processed),
                )

                scores.append(score)

            if not scores:
                continue

            score_final = max(scores)

            texto_faq_completo = " ".join([
                pergunta_faq or "",
                designacao or "",
                serve_text or "",
            ])

            faq_norm = normalizar_texto_match(texto_faq_completo)

            # Evita falsos positivos baseados apenas em termos genéricos,
            # como "licença".
            # Exemplo: "Quero pedir donativos na rua, preciso de licença?"
            # não deve devolver "Renovação da Licença" só porque ambas têm "licença".
            if (
                pergunta_norm != faq_norm
                and not tem_relacao_semantica_forte(pergunta, texto_faq_completo)
            ):
                continue

            if score_final > melhor_score:
                melhor_score = score_final
                melhor_faq = {
                    "faq_id": faq_id,
                    "pergunta": pergunta_faq,
                    "resposta": resposta,
                    "score": score_final,
                }

        if melhor_faq and melhor_faq["score"] >= threshold:
            return melhor_faq

        return None

    finally:
        cur.close()