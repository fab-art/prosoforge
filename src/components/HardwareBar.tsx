// ============================================================================
// HardwareBar.tsx — WebGPU detection + model selector + download progress
// ============================================================================

import { Cpu, Download, Trash2, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ModelId, RewriteIntensity } from "../types";

interface ModelOption {
  id: ModelId;
  label: string;
  vramMB: number;
  badge: string;
}

const MODELS: ModelOption[] = [
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 3B Instruct",
    vramMB: 2400,
    badge: "default",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B Instruct",
    vramMB: 2500,
    badge: "strong",
  },
  {
    id: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Gemma 2 2B IT",
    vramMB: 2000,
    badge: "light",
  },
];

interface Props {
  gpuSupported: boolean | null;
  gpuReason?: string;
  modelId: ModelId | null;
  modelReady: boolean;
  modelProgress: number;
  modelProgressText: string;
  vramMB: number;
  intensity: RewriteIntensity;
  onPickModel: (id: ModelId) => void;
  onClearModel: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  paused: boolean;
  processing: boolean;
}

export function HardwareBar(props: Props) {
  const {
    gpuSupported,
    gpuReason,
    modelId,
    modelReady,
    modelProgress,
    modelProgressText,
    vramMB,
    intensity,
    onPickModel,
    onClearModel,
    onPause,
    onResume,
    onCancel,
    paused,
    processing,
  } = props;

  return (
    <header className="border-b border-bg-border bg-bg-panel/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">ProseForge</h1>
            <p className="text-[10px] text-mute uppercase tracking-widest">
              WebGPU · client-side
            </p>
          </div>
        </div>

        {/* GPU status */}
        <div className="flex items-center gap-2 text-xs">
          {gpuSupported === null && (
            <span className="text-mute flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> Detecting GPU...
            </span>
          )}
          {gpuSupported === false && (
            <span className="text-err flex items-center gap-1" title={gpuReason}>
              <AlertTriangle className="w-3.5 h-3.5" /> WebGPU unavailable
            </span>
          )}
          {gpuSupported === true && (
            <span className="text-ok flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> WebGPU ready
            </span>
          )}
        </div>

        {/* Model selector */}
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-mute hidden sm:inline">Model</label>
          <select
            className="bg-bg-elevated border border-bg-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            value={modelId ?? ""}
            onChange={(e) => onPickModel(e.target.value as ModelId)}
            disabled={processing}
          >
            <option value="" disabled>
              Select a model...
            </option>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({(m.vramMB / 1024).toFixed(1)} GB)
              </option>
            ))}
          </select>

          {modelId && !modelReady && (
            <span className="text-xs text-accent-glow flex items-center gap-1">
              <Download className="w-3.5 h-3.5 animate-pulse" />
              {(modelProgress * 100).toFixed(0)}%
            </span>
          )}
          {modelReady && (
            <span className="text-xs text-ok flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {vramMB ? `${(vramMB / 1024).toFixed(1)}GB` : "loaded"}
            </span>
          )}

          <button
            className="text-xs text-mute hover:text-zinc-200 px-2 py-1.5 rounded-md border border-bg-border hover:border-zinc-600 disabled:opacity-40"
            onClick={onClearModel}
            disabled={!modelReady && !modelId}
            title="Clear cached WebLLM model from VRAM"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Pipeline controls */}
        {processing && (
          <div className="flex items-center gap-1 w-full sm:w-auto">
            <button
              className="text-xs px-3 py-1.5 rounded-md bg-bg-elevated border border-bg-border hover:border-accent disabled:opacity-40"
              onClick={paused ? onResume : onPause}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-md bg-err/10 border border-err/40 text-err hover:bg-err/20"
              onClick={onCancel}
            >
              Cancel
            </button>
            <span className="text-[10px] text-mute ml-1">
              intensity: <span className="text-accent-glow">{intensity}</span>
            </span>
          </div>
        )}
      </div>

      {/* Download progress bar */}
      {modelId && !modelReady && (
        <div className="h-0.5 bg-bg-border">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.max(2, modelProgress * 100)}%` }}
          />
        </div>
      )}
      {modelId && !modelReady && modelProgressText && (
        <div className="px-4 pb-2 text-[10px] text-mute truncate">
          {modelProgressText}
        </div>
      )}

      {gpuSupported === false && gpuReason && (
        <div className="px-4 pb-3 text-[11px] text-err/80 leading-relaxed">
          {gpuReason}
        </div>
      )}
    </header>
  );
}
