const ACTIVE = new Set(["queued", "allocating_ports", "starting", "health_checking", "registering_route"]);

const STYLES: Record<string, { dot: string; shell: string; label: string }> = {
  active: {
    dot: "bg-accent-bright",
    shell: "border-accent/30 bg-accent/10 text-accent-bright",
    label: "deploying",
  },
  running: {
    dot: "bg-green",
    shell: "border-green/30 bg-green/10 text-green",
    label: "running",
  },
  stopped: {
    dot: "bg-muted-2",
    shell: "border-panel-edge-2 bg-panel-2 text-muted",
    label: "stopped",
  },
  deleting: {
    dot: "bg-red",
    shell: "border-red/30 bg-red/10 text-red",
    label: "deleting",
  },
  unhealthy: {
    dot: "bg-red",
    shell: "border-red/30 bg-red/10 text-red",
    label: "unhealthy",
  },
  failed: {
    dot: "bg-red",
    shell: "border-red/30 bg-red/10 text-red",
    label: "failed",
  },
  crashed: {
    dot: "bg-red",
    shell: "border-red/30 bg-red/10 text-red",
    label: "crashed",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const isActive = ACTIVE.has(status);
  const s = isActive ? STYLES.active : STYLES[status] ?? STYLES.stopped;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${s.shell}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${isActive ? "breathe" : ""}`} />
      {s.label}
    </span>
  );
}
