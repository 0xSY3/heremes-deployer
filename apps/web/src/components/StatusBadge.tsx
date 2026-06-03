const STYLES: Record<string, { dot: string; text: string; label: string }> = {
  provisioning: { dot: "bg-amber", text: "text-amber", label: "provisioning" },
  running: { dot: "bg-green", text: "text-green", label: "running" },
  stopped: { dot: "bg-muted", text: "text-muted", label: "stopped" },
  failed: { dot: "bg-red", text: "text-red", label: "failed" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? STYLES.stopped;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest">
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === "provisioning" ? "breathe" : ""}`}
      />
      <span className={s.text}>{s.label}</span>
    </span>
  );
}
