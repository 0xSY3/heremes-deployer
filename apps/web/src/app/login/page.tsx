import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { googleSignIn } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="relative z-10 flex h-screen w-full flex-col overflow-hidden bg-ink">
      <div className="absolute inset-0 pointer-events-none z-0 flex items-center justify-center">
        <div className="w-[600px] h-[400px] bg-accent/5 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-6 py-6 lg:px-12 relative z-10">
        <nav className="flex items-center justify-between">
          <BrandMark sublabel="by Zynd" />
        </nav>

        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted transition-colors hover:bg-white/10 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
            </span>
            System Ready
          </div>

          <h1 className="max-w-3xl text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white mt-8 mb-6">
            Deploy your private <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-bright to-accent">Hermes agents</span> instantly.
          </h1>

          <p className="max-w-xl text-lg text-muted-2 leading-relaxed">
            Connect your API keys to isolated, containerized instances in a single click. Manage your personal agents securely without infrastructure overhead.
          </p>

          <div className="mt-12 flex items-center gap-6">
            <form action={googleSignIn}>
              <button
                type="submit"
                className="group inline-flex h-12 items-center justify-center gap-3 rounded-full bg-panel-2 border border-panel-edge px-8 text-sm font-semibold text-white transition-all hover:bg-panel hover:border-white/20"
              >
                <span>Sign in with Google</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted transition-transform group-hover:translate-x-1">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>
          </div>
          
          <div className="mt-16 text-xs text-muted-2 font-mono uppercase tracking-widest opacity-60">
            Built for the modern AI stack
          </div>
        </section>
      </div>
    </main>
  );
}

