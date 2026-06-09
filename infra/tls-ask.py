#!/usr/bin/env python3
# On-demand-TLS ask endpoint for Caddy. When per-agent subdomain routing is on
# (DEPLOYER_AGENT_SUBDOMAIN_BASE), each agent is served at <slug>.<base> and
# Caddy mints a cert on first request. Caddy GETs /tls-ask?domain=<host> first;
# we return 200 only for hosts under our base so Caddy will not mint certs for
# arbitrary domains pointed at this IP.
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

BASE = os.environ.get("AGENT_BASE", "").lower()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        q = parse_qs(urlparse(self.path).query)
        host = (q.get("domain", [""])[0]).lower()
        allowed = bool(BASE) and (host == BASE or host.endswith("." + BASE))
        self.send_response(200 if allowed else 404)
        self.end_headers()
        self.wfile.write(b"ok" if allowed else b"no")

    def log_message(self, *args) -> None:  # silence access logs
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 9000), Handler).serve_forever()
