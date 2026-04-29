from ..db import get_conn
from sentence_transformers import SentenceTransformer
import numpy as np
import faiss
import pickle
import logging
from ..config import Config
import os
from .text import preprocess_text

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
        melhor_score = 0
        melhor_faq = None

        for faq_id, pergunta_faq, resposta, designacao, serve_text in faqs:
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
