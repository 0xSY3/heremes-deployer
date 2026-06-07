MANUAL SMOKE — deploy WS path (run on the VPS after `systemctl start`):

1. Sign in to https://<domain>, click "Create Agent":
     name=smoke, provider=OpenRouter, key=<a real sk-or-... key>.
   -> POST /api/agents returns 201 {id, slug, status:"queued", wsToken}.
   -> a row exists:   psql hermes_deployer -c \
        "select id,status,slug from \"Agent\" where slug like 'smoke-%';"   (status=queued)
   -> the secret file exists, 0600, owner hermes:
        ls -l /var/lib/hermes-deployer/secrets/<id>.age

2. The modal switches to DeployProgress. Watch the checklist advance live:
     queued ✓ → allocating_ports ✓ → starting … → health_checking ✓
     → registering_route ✓ → running (Live). "Open dashboard →" appears.
   -> the WS is the worker's:   ss -ltnp | grep 7072   (worker listening, loopback)
   -> step order matches the DB:  the status column moves through the same
      sequence (DB is source of truth — refresh mid-deploy and confirm the
      checklist backfills to the current step, no lost progress).

3. Reconnect test: hard-refresh the page mid-"starting". The new socket sends
   `hello` with the current DB status and replays the prior `step` frames
   (backfill ring) — the checklist lands on the right step, not back at queued.

4. Auth gate: copy the ws URL, replace ?token= with garbage, connect via
     websocat 'wss://<domain>/v1/agents/<id>/deploy?token=garbage'
   -> closes immediately with code 4401 (no frames). Replace the agentId in a
      VALID token's URL with another agent's id -> the signature is over the
      agentId, so it still 4401s (agent_mismatch). A token for an agent you
      don't own -> 4403.

5. Dashboard reachable via Caddy (per-route basic-auth, owner-keyed):
     curl -kI https://<domain>/<slug>/      -> 401 without creds, 200 with.

6. DELETE: click delete in the UI (PATCH-less; DELETE /api/agents/<id>).
   -> row status flips to "stopped"; within one worker sweep the container is
      gone (docker ps has no hermes-<id>), the Caddy route is removed
      (curl https://<domain>/<slug>/ -> falls through to the web app / 404),
      and BOTH ports are released:
        psql -c "select count(*) from \"PortAllocation\" where \"agentId\"='<id>';"  -> 0
