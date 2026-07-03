import { prisma } from "@/lib/db";
import type { User } from "@/lib/auth";

// Ownership is anchored on TWO keys: the opaque Auth.js session id (`userId`)
// and the stable Google email (`ownerEmail`). Matching EITHER means the caller
// owns the agent. The email anchor is what lets ownership survive a session-id
// change — an auth-provider swap or DB rebuild reissues user ids, which on
// 2026-07-03 stranded every agent (all rows keyed to now-dead UUIDs). Email is
// stable across those events, so it is the durable identity.

type OwnerClause = { userId: string } | { ownerEmail: string };

// Build the owner-scoped `where` fragment. `user.email` can be "" if the
// provider omitted it; we never emit an empty-string clause because it would
// match every legacy row whose ownerEmail is also empty.
export function ownerWhere(user: User): { OR: OwnerClause[] } {
  const clauses: OwnerClause[] = [{ userId: user.id }];
  if (user.email) clauses.push({ ownerEmail: user.email });
  return { OR: clauses };
}

// Converge a row back onto the caller's current session id after it was matched
// by email (its stored userId is stale). This keeps id-keyed queries and the
// userId index effective and makes the row future-proof: once both userId and
// ownerEmail are current, only a change to the *email* could strand it again,
// which does not happen for a Google account. Idempotent. Non-fatal: a heal
// failure is logged but never blocks the read that triggered it (the agent is
// still returned this request via the email match, and the heal retries next
// request).
export async function healOwnership(user: User, agentId: string): Promise<void> {
  try {
    await prisma.agent.update({
      where: { id: agentId },
      data: { userId: user.id, ownerEmail: user.email || null },
    });
  } catch (e) {
    console.error(
      `[ownership] heal failed for ${agentId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

// Heal every row in a listing that was matched by email (stale userId). After
// the first heal a row matches by userId, so this fires at most once per row.
export async function healStale(
  user: User,
  rows: Array<{ id: string; userId: string }>,
): Promise<void> {
  const stale = rows.filter((r) => r.userId !== user.id);
  if (stale.length === 0) return;
  await Promise.all(stale.map((r) => healOwnership(user, r.id)));
}
