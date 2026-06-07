// Tiny Caddy admin API client. Routes are keyed by agent id (@id) so we
// can update/delete them without walking the config tree.
//
// Assumes Caddy is configured at boot with an HTTPS server (cfg.caddyServerName)
// that has an @id-addressable routes array. See infra/Caddyfile.

import { config as cfg } from "./config";

interface CaddyRoute {
  "@id": string;
  match: Array<{ host?: string[]; path?: string[] }>;
  // Two-stage handler: rewrite strips the path prefix so the upstream
  // (which serves at root) sees the request as if it came in directly,
  // then reverse_proxy forwards it. Order matters — rewrite must run
  // before reverse_proxy.
  handle: Array<
    | { handler: "rewrite"; strip_path_prefix: string }
    | { handler: "reverse_proxy"; upstreams: Array<{ dial: string }> }
  >;
}

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  // Caddy's admin API rejects requests whose Origin header isn't on the
  // configured allowlist. Node's fetch doesn't set Origin by default, so
  // the server sees origin '' and returns 403. Pin it to the admin URL
  // itself, which matches Caddy's default loopback allowlist
  // (127.0.0.1, localhost, ::1).
  return fetch(`${cfg.caddyAdminUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Origin: cfg.caddyAdminUrl,
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Ensure the target Caddy server exists and has a `routes: []` array we
 * can append to. On a freshly-booted Caddy with no config loaded, the
 * HTTP app and the named server don't exist yet, so POST .../routes/...
 * fails with 500 {"error":"final element is not an array"} and every
 * single deploy is torn down. Idempotent: a server that already has a
 * routes array makes this a no-op.
 */
export async function ensureServer(): Promise<void> {
  if (cfg.skipCaddy) return;

  // Probe first — if the server already has a routes array we're done.
  const probe = await adminFetch(
    `/config/apps/http/servers/${cfg.caddyServerName}`,
    { method: "GET" },
  );
  if (probe.ok) {
    try {
      const body = (await probe.json()) as { routes?: unknown };
      if (Array.isArray(body.routes)) {
        return;
      }
    } catch {
      // probe returned 200 but not JSON — fall through and rewrite
    }
  }

  // Push the whole apps.http.servers.<name> sub-tree via POST /load.
  // /load (replaces full config) is the documented way to bootstrap from
  // an empty config; PUT to a missing parent path returns 4xx. We fetch
  // the existing config first so we don't blow away other apps.
  const currentRes = await adminFetch(`/config/`, { method: "GET" });
  let current: Record<string, unknown> = {};
  if (currentRes.ok) {
    try {
      current = (await currentRes.json()) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  const merged = structuredClone(current ?? {}) as {
    apps?: {
      http?: {
        servers?: Record<string, { listen?: unknown; routes?: unknown }>;
      };
    };
  };
  merged.apps ??= {};
  merged.apps.http ??= {};
  merged.apps.http.servers ??= {};
  const existing = merged.apps.http.servers[cfg.caddyServerName] ?? {};
  merged.apps.http.servers[cfg.caddyServerName] = {
    listen:
      Array.isArray(existing.listen) && existing.listen.length > 0
        ? existing.listen
        : [":443"],
    ...existing,
    routes: Array.isArray(existing.routes) ? existing.routes : [],
  };

  const load = await adminFetch(`/load`, {
    method: "POST",
    body: JSON.stringify(merged),
  });
  if (!load.ok) {
    const text = await load.text();
    throw new Error(
      `Caddy ensureServer failed: POST /load returned ${load.status} ${text}`,
    );
  }

  // Re-probe to confirm the shape before we let addRoute run.
  const verify = await adminFetch(
    `/config/apps/http/servers/${cfg.caddyServerName}`,
    { method: "GET" },
  );
  if (!verify.ok) {
    throw new Error(
      `Caddy ensureServer: post-load probe returned ${verify.status}`,
    );
  }
  const verifyBody = (await verify.json()) as { routes?: unknown };
  if (!Array.isArray(verifyBody.routes)) {
    throw new Error(
      `Caddy ensureServer: server "${cfg.caddyServerName}" has routes=${typeof verifyBody.routes} after /load — expected array`,
    );
  }
}

/**
 * Route the agent's dashboard port behind `/<slug>`.
 *
 * Hermes differs from zynd: a single path segment `/<slug>` (no
 * entityType prefix), @id is the agentId, and the upstream is the
 * dashboard host port (container 9119), not the API port.
 */
export async function addRoute(
  agentId: string,
  slug: string,
  dashboardPort: number,
): Promise<void> {
  if (cfg.skipCaddy) return;
  const host = cfg.wildcardDomain;
  const prefix = `/${slug}`;
  // Match the prefix exactly (so /<slug> with no trailing slash still
  // routes) AND any subpath: Caddy's `/<slug>/*` matcher excludes the
  // bare /<slug>.
  const route: CaddyRoute = {
    "@id": agentId,
    match: [{ host: [host], path: [prefix, `${prefix}/*`] }],
    handle: [
      { handler: "rewrite", strip_path_prefix: prefix },
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `127.0.0.1:${dashboardPort}` }],
      },
    ],
  };
  await prependRoute(route);
}

async function prependRoute(route: CaddyRoute): Promise<void> {
  const path = `/config/apps/http/servers/${cfg.caddyServerName}/routes`;

  const readCurrent = async (): Promise<CaddyRoute[]> => {
    const r = await adminFetch(path, { method: "GET" });
    if (!r.ok) return [];
    const body = (await r.json()) as unknown;
    return Array.isArray(body) ? (body as CaddyRoute[]) : [];
  };

  let current = await readCurrent();
  if (current.length === 0) {
    // Empty, or the server itself is missing — bootstrap and re-read.
    await ensureServer();
    current = await readCurrent();
  }

  // Drop any existing entry with the same @id so redeploys/restarts don't
  // accumulate duplicates.
  const deduped = current.filter((r) => r["@id"] !== route["@id"]);
  // Prepend at HEAD: the Caddyfile catch-all that forwards the bare
  // domain to the Next UI lives further down; first-match-wins would
  // otherwise route /<slug>/* to Next instead of the container.
  const next = [route, ...deduped];

  // PATCH replaces the value at the path. PUT errors 409 "key already
  // exists" whenever the array is already present (every case but a
  // brand-new server).
  const res = await adminFetch(path, {
    method: "PATCH",
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    throw new Error(
      `Caddy addRoute failed: PATCH ${path} returned ${res.status} ${await res.text()}`,
    );
  }
}

export async function removeRoute(agentId: string): Promise<void> {
  if (cfg.skipCaddy) return;
  const res = await adminFetch(`/id/${agentId}`, { method: "DELETE" });
  // 404 means the route already went away — idempotent for our use
  // (reverse-order rollback in §5 may call this after the route is gone).
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Caddy removeRoute failed: ${res.status} ${await res.text()}`,
    );
  }
}

export { adminFetch };
export type { CaddyRoute };
