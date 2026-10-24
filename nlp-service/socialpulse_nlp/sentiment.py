"""VADER-based sentiment classification with batch support."""

from dataclasses import asdict, dataclass

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from . import MODEL_NAME, MODEL_VERSION
from .cleaning import ascii_ratio, clean_text

# Standard thresholds recommended by the VADER authors.
POSITIVE_THRESHOLD = 0.05
NEGATIVE_THRESHOLD = -0.05
MAX_BATCH_SIZE = 1000

_analyzer = SentimentIntensityAnalyzer()


@dataclass
class SentimentResult:
    id: str | None
    label: str
    score: float  # VADER compound score in [-1, 1]
    confidence: float  # |compound|, a rough strength indicator
    positive: float
    neutral: float
    negative: float
    clean_text: str
    model: str = MODEL_NAME
    model_version: str = MODEL_VERSION
    warnings: list[str] | None = None
    error: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def label_for(compound: float) -> str:
    if compound >= POSITIVE_THRESHOLD:
        return "positive"
    if compound <= NEGATIVE_THRESHOLD:
        return "negative"
    return "neutral"


def analyze(text: object, item_id: str | None = None, language: str | None = None) -> SentimentResult:
    """Classify a single text. Never raises for malformed input."""
    warnings: list[str] = []
    if text is None or (isinstance(text, str) and not text.strip()):
        return SentimentResult(item_id, "neutral", 0.0, 0.0, 0.0, 1.0, 0.0, "",
                               warnings=["empty_text"])
    if not isinstance(text, str):
        warnings.append("non_string_text_coerced")
    cleaned = clean_text(text)
    if not cleaned:
        return SentimentResult(item_id, "neutral", 0.0, 0.0, 0.0, 1.0, 0.0, "",
                               warnings=warnings + ["empty_after_cleaning"])
    if (language and not language.lower().startswith("en")) or ascii_ratio(cleaned) < 0.6:
        # VADER's lexicon is English-only; scores for other languages are unreliable.
        warnings.append("non_english_text_low_reliability")
    scores = _analyzer.polarity_scores(cleaned)
    compound = round(float(scores["compound"]), 4)
    return SentimentResult(
        id=item_id,
        label=label_for(compound),
        score=compound,
        confidence=round(abs(compound), 4),
        positive=round(float(scores["pos"]), 4),
        neutral=round(float(scores["neu"]), 4),
        negative=round(float(scores["neg"]), 4),
        clean_text=cleaned,
        warnings=warnings or None,
    )


def analyze_batch(items: object) -> list[dict]:
    """Classify a list of {id, text, language?} items (or plain strings).

    Malformed items produce a result with an ``error`` field instead of
    failing the whole batch.
    """
    if not isinstance(items, list):
        raise ValueError("items must be a list")
    if len(items) > MAX_BATCH_SIZE:
        raise ValueError(f"batch too large (max {MAX_BATCH_SIZE})")
    results: list[dict] = []
    for index, item in enumerate(items):
        if isinstance(item, str):
            results.append(analyze(item, str(index)).to_dict())
            continue
        if not isinstance(item, dict):
            results.append(_error_result(str(index), "item must be an object or string"))
            continue
        item_id = item.get("id")
        item_id = str(item_id) if item_id is not None else str(index)
        if "text" not in item:
            results.append(_error_result(item_id, "missing 'text' field"))
            continue
        language = item.get("language") if isinstance(item.get("language"), str) else None
        results.append(analyze(item["text"], item_id, language).to_dict())
    return results


def _error_result(item_id: str, message: str) -> dict:
    return SentimentResult(item_id, "neutral", 0.0, 0.0, 0.0, 1.0, 0.0, "", error=message).to_dict()
