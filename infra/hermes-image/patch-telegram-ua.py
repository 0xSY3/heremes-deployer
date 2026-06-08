#!/usr/bin/env python3
"""Add a browser User-Agent to Hermes's Telegram onboarding request.

Why: Hermes 0.16.0 builds the onboarding request to the Nous setup service
(https://setup.hermes-agent.nousresearch.com/v1/telegram/pairings) with no
User-Agent, so urllib sends the default "Python-urllib/<ver>". The Nous
Cloudflare Worker blocks that UA with HTTP 403, which web_server.py maps to a
502 "Telegram setup service returned an error." — breaking the dashboard's
"Set up with QR" flow for every self-hosted container.

The fix sets a browser UA on the two header dicts in web_server.py that talk to
external services via urllib. Build-time only; idempotent so a re-run (or a no-op
on an already-fixed upstream) is safe.

Upstream bug: _telegram_onboarding_request_sync omits User-Agent. Remove this
patch once a Hermes release sets one itself.
"""

import sys

UA = '"User-Agent": "Mozilla/5.0", '
NEEDLE = 'headers = {"Accept": "application/json"}'
PATCHED = 'headers = {' + UA + '"Accept": "application/json"}'

path = sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes/hermes_cli/web_server.py"

with open(path, "r", encoding="utf-8") as f:
    src = f.read()

if PATCHED in src:
    print(f"[patch] already applied to {path}")
    sys.exit(0)

count = src.count(NEEDLE)
if count == 0:
    # Upstream may have fixed it / refactored the line. Fail loudly so a version
    # bump doesn't silently ship an unpatched image.
    print(f"[patch] FATAL: anchor not found in {path}; Hermes changed the "
          f"onboarding header construction — re-check the patch.", file=sys.stderr)
    sys.exit(1)

src = src.replace(NEEDLE, PATCHED)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print(f"[patch] added browser User-Agent to {count} header dict(s) in {path}")
