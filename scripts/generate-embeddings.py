"""
generate-embeddings.py — Embed pytest plugin descriptions for semantic search.

Uses multi-qa-MiniLM-L6-cos-v1, a model trained for asymmetric semantic search
(short natural-language queries → plugin name + summary passages).

Usage:
  uv run scripts/generate-embeddings.py
"""

import json
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
from sentence_transformers import SentenceTransformer
from sklearn.decomposition import PCA

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DATA_PATH = PROJECT_ROOT / "plugins-data.json"
DATA_DIR = PROJECT_ROOT / "data"
EMBEDDINGS_PATH = DATA_DIR / "embeddings.json"
SUMMARIES_PATH = DATA_DIR / "summaries-cache.json"

MODEL = "multi-qa-MiniLM-L6-cos-v1"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with open(PLUGINS_DATA_PATH, encoding="utf-8") as f:
        plugins: list[dict] = json.load(f)["plugins"]

    summaries: dict[str, dict] = {}
    if SUMMARIES_PATH.exists():
        with open(SUMMARIES_PATH, encoding="utf-8") as f:
            summaries = json.load(f) or {}

    names: list[str] = []
    texts: list[str] = []
    for p in plugins:
        name = p.get("name")
        if not name:
            continue
        s = (summaries.get(name, {}) or {}).get("summary")
        if not s:
            s = (p.get("summary") or "").strip()
        if not s:
            s = f"pytest plugin: {name}"
        names.append(name)
        texts.append(f"{name}: {s.strip()}")

    print(f"Encoding {len(texts)} plugins with {MODEL}…")
    model = SentenceTransformer(MODEL)
    raw: np.ndarray = model.encode(
        texts, batch_size=32, show_progress_bar=True, normalize_embeddings=True
    )  # shape (N, 384)

    print("Applying PCA → 64 dims…")
    pca = PCA(n_components=64, random_state=42)
    reduced: np.ndarray = pca.fit_transform(raw)
    variance = float(pca.explained_variance_ratio_.sum())
    print(f"Variance explained: {variance:.3f}")

    # Re-normalise after PCA so dot product == cosine similarity
    norms = np.linalg.norm(reduced, axis=1, keepdims=True)
    reduced = reduced / np.where(norms == 0, 1.0, norms)

    output = {
        "meta": {
            "model": MODEL,
            "pca_dims": 64,
            "pca_variance_explained": round(variance, 6),
            "generated": now_iso(),
            "n_plugins": len(names),
        },
        # Stored so the browser can project query embeddings into the same PCA space
        "pca_components": [[round(float(v), 6) for v in row] for row in pca.components_],
        "pca_mean": [round(float(v), 6) for v in pca.mean_],
        "embeddings": {
            name: [round(float(v), 5) for v in reduced[i]]
            for i, name in enumerate(names)
        },
    }

    with open(EMBEDDINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f)
        f.write("\n")

    print(f"Done → {EMBEDDINGS_PATH}  ({len(names)} plugins, ~{EMBEDDINGS_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
