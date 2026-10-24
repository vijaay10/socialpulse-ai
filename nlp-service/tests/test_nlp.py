import json
import threading
import urllib.error
import urllib.request

import pytest

from socialpulse_nlp.cleaning import clean_text, extract_hashtags
from socialpulse_nlp.sentiment import analyze, analyze_batch, label_for
from socialpulse_nlp.server import create_server


def test_clean_text_removes_urls_mentions_and_hash_symbols():
    text = "Loving the fest @nova_reviews!! https://t.co/xyz #CampusFest &amp; more"
    assert clean_text(text) == "Loving the fest !! CampusFest & more"


def test_clean_text_handles_none_and_non_strings():
    assert clean_text(None) == ""
    assert clean_text(12345) == "12345"


def test_extract_hashtags_normalises_and_deduplicates():
    assert extract_hashtags("#AI rocks #ai #Chennai2026") == ["ai", "chennai2026"]


@pytest.mark.parametrize(
    "text,label",
    [
        ("This is absolutely amazing, I love it!", "positive"),
        ("Worst service ever, totally disappointed and angry.", "negative"),
        ("The train leaves at 5 pm from platform 3.", "neutral"),
    ],
)
def test_analyze_labels(text, label):
    result = analyze(text)
    assert result.label == label
    assert -1.0 <= result.score <= 1.0
    assert result.model == "vader"


def test_label_thresholds():
    assert label_for(0.05) == "positive"
    assert label_for(-0.05) == "negative"
    assert label_for(0.0) == "neutral"


def test_empty_text_is_neutral_with_warning():
    result = analyze("   ")
    assert result.label == "neutral"
    assert result.warnings == ["empty_text"]


def test_non_english_warning():
    result = analyze("यह बहुत अच्छा है", language="hi")
    assert "non_english_text_low_reliability" in (result.warnings or [])


def test_batch_handles_malformed_items():
    results = analyze_batch([
        {"id": "a", "text": "great day"},
        {"id": "b"},
        42,
        "plain string works",
        {"id": "c", "text": None},
    ])
    assert [r["id"] for r in results] == ["a", "b", "2", "3", "c"]
    assert results[0]["label"] == "positive"
    assert results[1]["error"] == "missing 'text' field"
    assert results[2]["error"] is not None
    assert results[4]["warnings"] == ["empty_text"]


def test_batch_rejects_non_list():
    with pytest.raises(ValueError):
        analyze_batch({"text": "x"})


@pytest.fixture()
def server_url():
    server = create_server("127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def _post(url, payload):
    data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read())


def test_http_health_and_batch(server_url):
    with urllib.request.urlopen(server_url + "/health", timeout=5) as resp:
        assert json.loads(resp.read())["status"] == "ok"
    status, body = _post(server_url + "/analyze/batch", {"items": [{"id": "1", "text": "I love this"}]})
    assert status == 200
    assert body["results"][0]["label"] == "positive"


def test_http_rejects_invalid_json(server_url):
    with pytest.raises(urllib.error.HTTPError) as exc:
        _post(server_url + "/analyze/batch", b"{not json")
    assert exc.value.code == 400
