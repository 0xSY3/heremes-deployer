import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { googleSignIn } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <div className="rise w-[min(420px,92vw)] rounded-xl border border-panel-edge bg-ink-2 p-9 text-center shadow-2xl">
        <div className="font-display text-5xl text-gold">⚕</div>
        <h1 className="mt-5 font-display text-3xl text-parchment">Hermes</h1>
        <p className="mt-2 text-sm text-muted">
          Your own private agent, booted in one click. Sign in to begin.
        </p>

        <form action={googleSignIn} className="mt-8">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded bg-parchment px-5 py-3 text-sm font-bold text-ink transition-opacity hover:opacity-90"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-[11px] text-muted">
          Free. We only use Google to keep agents tied to a real account.
        </p>
      </div>
    </main>
  );
}
