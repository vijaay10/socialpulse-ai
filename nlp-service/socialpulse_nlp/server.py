"""Minimal JSON HTTP API for the NLP module (stdlib only, no web framework).

Endpoints:
  GET  /health          -> {"status": "ok", "model": ..., "model_version": ...}
  POST /analyze         -> body {"text": str, "language"?: str}
  POST /analyze/batch   -> body {"items": [{"id", "text", "language"?}, ...]}
"""

import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import MODEL_NAME, MODEL_VERSION
from .sentiment import analyze, analyze_batch

MAX_BODY_BYTES = 5 * 1024 * 1024
log = logging.getLogger("socialpulse_nlp")


class Handler(BaseHTTPRequestHandler):
    server_version = "SocialPulseNLP/1.0"

    def log_message(self, fmt: str, *args: object) -> None:  # route to logging
        log.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> object:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("request body is required")
        if length > MAX_BODY_BYTES:
            raise ValueError("request body too large")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON: {exc.msg}") from exc

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"status": "ok", "model": MODEL_NAME, "model_version": MODEL_VERSION})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._read_json()
            if not isinstance(body, dict):
                raise ValueError("JSON body must be an object")
            if self.path == "/analyze":
                language = body.get("language") if isinstance(body.get("language"), str) else None
                self._send(200, analyze(body.get("text"), language=language).to_dict())
            elif self.path == "/analyze/batch":
                results = analyze_batch(body.get("items"))
                self._send(200, {"model": MODEL_NAME, "model_version": MODEL_VERSION, "results": results})
            else:
                self._send(404, {"error": "not found"})
        except ValueError as exc:
            self._send(400, {"error": str(exc)})
        except Exception:  # pragma: no cover - defensive
            log.exception("unhandled error")
            self._send(500, {"error": "internal error"})


def create_server(host: str = "0.0.0.0", port: int = 8000) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
    host = os.environ.get("NLP_HOST", "0.0.0.0")
    port = int(os.environ.get("NLP_PORT", "8000"))
    server = create_server(host, port)
    log.info("SocialPulse NLP service listening on %s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
