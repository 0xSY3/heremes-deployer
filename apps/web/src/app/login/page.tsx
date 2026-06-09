import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { googleSignIn } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="relative z-10 flex h-screen flex-col overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
        <nav className="rise flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-panel-edge bg-ink-2/70 px-5 py-3 backdrop-blur">
          <BrandMark sublabel="Hermes Deployer" />
          <span className="hidden items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-bright sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-bright" />
            One-click deployer
          </span>
        </nav>

        <section className="grid min-h-0 flex-1 items-center gap-6 py-4 lg:grid-cols-[1.2fr_420px]">
          <div className="rise" style={{ animationDelay: "80ms" }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-bright">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-bright opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-bright" />
              </span>
              Launch without server work
            </span>

            <h1 className="font-display mt-5 max-w-3xl text-[clamp(2.25rem,5.2vw,4rem)] leading-[0.98]">
              <span className="display-fill">One clean deploy flow for private </span>
              <span className="hermes-glow">Hermes</span>
              <span className="display-fill"> agents</span>
            </h1>

            <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
              Boot a private Hermes agent with web chat, Telegram onboarding, live logs, health checks,
              and a shareable dashboard URL without touching the server.
            </p>

            <form action={googleSignIn} className="mt-6 max-w-sm">
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-panel-edge bg-panel px-5 text-sm font-semibold text-parchment transition hover:border-accent/45 hover:bg-panel-2"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                  <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                </svg>
                Continue with Google
              </button>
            </form>
          </div>

          <div className="rise hidden lg:block" style={{ animationDelay: "150ms" }}>
            <div className="deploy-terminal corner-frame rounded-2xl border border-panel-edge bg-panel/80 p-5 shadow-2xl shadow-black/30">
              <div className="flex items-center justify-between border-b border-panel-edge pb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-bright">
                    Deploy flow
                  </p>
                  <h2 className="font-display mt-1.5 text-xl uppercase tracking-wide text-parchment">
                    Hermes agent boot
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green/30 bg-green/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  Ready
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {[
                  ["01", "Reserve API + dashboard ports"],
                  ["02", "Encrypt BYO model key"],
                  ["03", "Start isolated Hermes container"],
                  ["04", "Register secure route"],
                  ["05", "Open private dashboard"],
                ].map(([step, label]) => (
                  <div
                    key={step}
                    className="flex items-center gap-3 rounded-lg border border-panel-edge bg-ink-2/70 px-3 py-2.5"
                  >
                    <span className="font-mono text-xs text-accent-bright">{step}</span>
                    <span className="flex-1 text-sm text-parchment">{label}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-green">
                      ok
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
