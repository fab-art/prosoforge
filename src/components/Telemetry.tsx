// ============================================================================
// Telemetry.tsx — Live agent stage + burstiness/AI-tell reduction meters
// ============================================================================

import { Activity, Gauge, TrendingDown, AlertCircle } from "lucide-react";
import type { AgentStage } from "../types";

interface Props {
  stage: AgentStage;
  processed: number;
  total: number;
  burstinessDelta: number;
  aiTellReduction: number;
  flaggedCount: number;
}

const STAGE_LABEL: Record<AgentStage, string> = {
  idle: "Idle",
  extracting: "Agent 1 · Extracting .docx",
  sanitizing: "Agent 2 · Sanitizing & locking citations",
  triaging: "Agent 3 · Triaging paragraphs",
  rewriting: "Agent 4 · Structural rewrite (WebGPU)",
  auditing: "Agent 5 · Integrity audit",
  rebuilding: "Rebuilding .docx archive",
  complete: "Pipeline complete",
  error: "Pipeline error",
};

export function Telemetry({
  stage,
  processed,
  total,
  burstinessDelta,
  aiTellReduction,
  flaggedCount,
}: Props) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const active = stage !== "idle" && stage !== "complete" && stage !== "error";

  return (
    <section className="bg-bg-panel border border-bg-border rounded-xl p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-accent" />
        Live Agent Telemetry
      </h2>

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-300">
          {active && (
            <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse mr-2 align-middle" />
          )}
          {STAGE_LABEL[stage]}
        </span>
        <span className="text-xs text-mute font-mono">
          {processed}/{total || "—"}
        </span>
      </div>

      <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
        <Metric
          icon={<Gauge className="w-3 h-3" />}
          label="Burstiness Δ"
          value={`+${burstinessDelta.toFixed(1)}`}
          tone="ok"
        />
        <Metric
          icon={<TrendingDown className="w-3 h-3" />}
          label="AI tells cut"
          value={`${aiTellReduction.toFixed(1)}`}
          tone="ok"
        />
        <Metric
          icon={<AlertCircle className="w-3 h-3" />}
          label="Flagged"
          value={`${flaggedCount}`}
          tone={flaggedCount > 0 ? "warn" : "mute"}
        />
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "err" | "mute";
}) {
  const color =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
      ? "text-warn"
      : tone === "err"
      ? "text-err"
      : "text-mute";
  return (
    <div className="bg-bg-base border border-bg-border rounded-md p-2.5">
      <div className="flex items-center gap-1 text-[10px] text-mute uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className={`text-base font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
