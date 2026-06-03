import { auth } from "@/auth";

export interface User {
  id: string;
  email: string;
  name: string;
}

// Returns null when not signed in; callers redirect to /login or return 401.
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "there",
  };
}
