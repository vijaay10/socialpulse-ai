"""Text cleaning for short, noisy social-media posts."""

import html
import re
import unicodedata

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
MENTION_RE = re.compile(r"(?<!\w)@\w{1,50}")
HASHTAG_RE = re.compile(r"(?<!\w)#(\w{1,100})", re.UNICODE)
WHITESPACE_RE = re.compile(r"\s+")
CONTROL_RE = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]")

MAX_TEXT_LENGTH = 5000


def clean_text(text: object) -> str:
    """Normalise text for sentiment scoring.

    URLs and @mentions are removed (they carry no sentiment for VADER), the '#'
    is stripped from hashtags so the word itself can still be scored, HTML
    entities are decoded and whitespace is collapsed. Emoji are kept because
    VADER understands many of them.
    """
    if text is None:
        return ""
    if not isinstance(text, str):
        text = str(text)
    text = text[:MAX_TEXT_LENGTH]
    text = unicodedata.normalize("NFC", html.unescape(text))
    text = CONTROL_RE.sub(" ", text)
    text = URL_RE.sub(" ", text)
    text = MENTION_RE.sub(" ", text)
    text = HASHTAG_RE.sub(lambda m: m.group(1), text)
    return WHITESPACE_RE.sub(" ", text).strip()


def extract_hashtags(text: object) -> list[str]:
    """Return normalised (lower-case, de-duplicated, ordered) hashtags."""
    if not isinstance(text, str):
        return []
    seen: dict[str, None] = {}
    for tag in HASHTAG_RE.findall(text):
        seen.setdefault(tag.lower(), None)
    return list(seen)


def ascii_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 1.0
    return sum(1 for c in letters if c.isascii()) / len(letters)
