// Shared wordmark lockup ("ZYND AI / HERMES DEPLOYER") with an optional product
// sublabel. Keeps the brand identical across nav, login, and the deploy modal.
export function BrandMark({
  sublabel,
  size = "md",
}: {
  sublabel?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-col font-display font-bold text-foreground">
      <span className={size === "sm" ? "text-lg tracking-wide" : "text-2xl tracking-wide"}>
        ZYND AI <span className="mx-1 opacity-50">/</span> HERMES DEPLOYER
      </span>
      {sublabel && (
        <p className="mt-1 text-[9px] font-mono font-medium uppercase tracking-[0.2em] text-muted-2">
          {sublabel}
        </p>
      )}
    </div>
  );
}
