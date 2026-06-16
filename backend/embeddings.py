from sentence_transformers import SentenceTransformer

from config import EMBEDDING_MODEL_NAME

embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
VECTOR_SIZE = embedding_model.get_sentence_embedding_dimension()


def create_embedding(text: str) -> list[float]:
    vector = embedding_model.encode(text, normalize_embeddings=True)
    return vector.tolist()
