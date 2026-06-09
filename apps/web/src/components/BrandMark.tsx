import Image from "next/image";

// Shared zynd.ai-style lockup: logo glyph + "ZYND" white / "AI" accent wordmark,
// with an optional product sublabel. Keeps the brand identical across nav,
// login, and the deploy modal.
export function BrandMark({
  sublabel,
  size = "md",
}: {
  sublabel?: string;
  size?: "sm" | "md";
}) {
  const glyph = size === "sm" ? 30 : 36;
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/assets/zynd-logo-white.png"
        alt="ZYND"
        width={glyph}
        height={glyph}
        priority
        className="rounded-md ring-1 ring-white/10"
        style={{ width: glyph, height: glyph }}
      />
      <div className="leading-none">
        <span className="brand-mark text-xl">
          <span className="text-green">Hermes</span>
          <span className="text-white">Deployer</span>
        </span>
        {sublabel && (
          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-2">
            {sublabel}
          </p>
        )}
      </div>
    </div>
  );
}
