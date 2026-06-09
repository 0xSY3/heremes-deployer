import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { googleSignIn } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="relative z-10 flex min-h-screen w-full flex-col bg-background font-sans text-foreground selection:bg-foreground selection:text-white">
      {/* Top Nav */}
      <nav className="flex items-center justify-between border-b border-panel-edge shrink-0 w-full z-10 px-6 py-4">
        <BrandMark />
        
        <div className="flex items-center gap-4">
          <div className="h-4 w-4 bg-foreground/20 rounded-full" />
          <div className="h-4 w-4 bg-foreground/20 rounded-full" />
        </div>
      </nav>

      <section className="flex flex-col items-center justify-center flex-1 px-6 py-20 text-center relative">
        <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-muted-2 uppercase mb-4">
          Hermes Deployer • Zynd
        </div>
        
        <h1 className="font-display max-w-4xl text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-foreground uppercase leading-[1.05] mb-6">
          THE AGENT THAT<br />GROWS WITH YOU.
        </h1>

        <p className="max-w-xl text-[17px] leading-relaxed text-muted mb-12">
          Connect your API keys to isolated, containerized Hermes instances. An autonomous agent that lives on your server, remembers what it learns, and gets more capable the longer it runs.
        </p>

        <div className="w-full max-w-xl text-left">

          <div className="mb-2 text-[10px] font-mono font-bold tracking-[0.15em] text-muted-2 uppercase px-2 flex justify-between">
            <span>1. AUTHENTICATE</span>
            <span className="opacity-50">Secure</span>
          </div>
          
          <form action={googleSignIn} className="w-full">
            <button
              type="submit"
              className="group w-full flex items-center justify-center gap-3 border border-foreground bg-foreground px-4 py-4 text-sm font-bold text-white transition-all hover:bg-transparent hover:text-foreground mt-2"
            >
              <span>Sign in with Google</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>

          <div className="mt-8 mb-2 text-[10px] font-mono font-bold tracking-[0.15em] text-muted-2 uppercase px-2">
            2. CONFIGURE
          </div>
          <div className="w-full flex items-center justify-between border border-panel-edge bg-transparent px-4 py-3 font-mono text-sm text-muted-2">
            <span>hermes setup --interactive</span>
          </div>
        </div>
      </section>

    </main>
  );
}

