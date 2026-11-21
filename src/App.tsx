// ============================================================================
// App.tsx — Top-level layout wiring all components to the pipeline worker
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import { HardwareBar } from "./components/HardwareBar";
import { SetupDrawer } from "./components/SetupDrawer";
import { Telemetry } from "./components/Telemetry";
import { DiffInspector } from "./components/DiffInspector";
import { ExportPanel } from "./components/ExportPanel";
import { usePipelineWorker } from "./hooks/usePipelineWorker";
import type { ModelId, RewriteIntensity } from "./types";

export default function App() {
  const {
    state,
    initModel,
    processDocx,
    pause,
    resume,
    cancel,
    reroll,
    clearModel,
    clearError,
  } = usePipelineWorker();

  const [filename, setFilename] = useState<string | null>(null);
  const [docxBlob, setDocxBlob] = useState<ArrayBuffer | null>(null);
  const [intensity, setIntensity] = useState<RewriteIntensity>("balanced");
  const [styleSample, setStyleSample] = useState("");
  const [glossaryTerms, setGlossaryTerms] = useState<string[]>([]);

  const onUpload = useCallback((file: File) => {
    setFilename(file.name);
    file.arrayBuffer().then((buf) => setDocxBlob(buf));
  }, []);

  const onPickModel = useCallback(
    (id: ModelId) => {
      initModel(id, intensity, styleSample || undefined, glossaryTerms);
    },
    [initModel, intensity, styleSample, glossaryTerms]
  );

  const onStart = useCallback(() => {
    if (!docxBlob || !filename) return;
    processDocx(
      docxBlob,
      filename,
      intensity,
      styleSample || undefined,
      glossaryTerms
    );
  }, [docxBlob, filename, intensity, styleSample, glossaryTerms, processDocx]);

  const onAccept = useCallback((index: number) => {
    // Accept is implicit — the paragraph stays as-is in the working set.
    void index;
  }, []);
  const onRevert = useCallback(
    (index: number) => {
      // Re-reroll from the original sanitized text (deterministic fallback).
      void index;
      reroll(index);
    },
    [reroll]
  );
  const onEdit = useCallback((index: number, newText: string) => {
    // Local override — we can't write back into the worker DOM from here,
    // but we CAN stage it for a future export. For now we surface a log.
    console.info(`Manual edit for paragraph ${index}: ${newText.slice(0, 60)}...`);
  }, []);

  const telemetry = state.telemetry;
  const flaggedCount = useMemo(
    () =>
      Array.from(state.paragraphs.values()).filter(
        (p) => p.status === "flagged"
      ).length,
    [state.paragraphs]
  );

  const processing =
    state.stage !== "idle" &&
    state.stage !== "complete" &&
    state.stage !== "error";

  return (
    <div className="min-h-screen bg-bg-base">
      <HardwareBar
        gpuSupported={state.gpuSupported}
        gpuReason={state.gpuReason}
        modelId={state.modelId}
        modelReady={state.modelReady}
        modelProgress={state.modelProgress}
        modelProgressText={state.modelProgressText}
        vramMB={state.vramMB}
        intensity={intensity}
        onPickModel={onPickModel}
        onClearModel={clearModel}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
        paused={state.paused}
        processing={processing}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          <SetupDrawer
            onUpload={onUpload}
            docStats={state.docStats}
            filename={filename}
            intensity={intensity}
            onIntensityChange={setIntensity}
            styleSample={styleSample}
            onStyleSampleChange={setStyleSample}
            glossaryTerms={glossaryTerms}
            onGlossaryChange={setGlossaryTerms}
            onStart={onStart}
            canStart={!!docxBlob && !!state.modelReady && !processing}
            processing={processing}
          />

          <Telemetry
            stage={state.stage}
            processed={telemetry?.processed ?? 0}
            total={telemetry?.total ?? 0}
            burstinessDelta={telemetry?.burstinessDelta ?? 0}
            aiTellReduction={telemetry?.aiTellReduction ?? 0}
            flaggedCount={flaggedCount}
          />

          {state.finalDocx && (
            <ExportPanel
              finalDocx={state.finalDocx}
              auditReport={state.auditReport}
            />
          )}

          {state.error && (
            <div className="bg-err/10 border border-err/40 rounded-xl p-3 text-xs text-err flex items-start gap-2">
              <span className="flex-1">{state.error}</span>
              <button onClick={clearError} className="text-err/60 hover:text-err">
                ×
              </button>
            </div>
          )}

          {/* Live logs */}
          {state.logs.length > 0 && (
            <div className="bg-bg-panel border border-bg-border rounded-xl p-3">
              <div className="text-[10px] text-mute uppercase tracking-wider mb-1.5">
                Pipeline log
              </div>
              <div className="max-h-40 overflow-y-auto font-mono text-[10px] leading-relaxed space-y-0.5">
                {state.logs.slice(-30).map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.level === "error"
                        ? "text-err"
                        : l.level === "warn"
                        ? "text-warn"
                        : "text-mute"
                    }
                  >
                    {l.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <DiffInspector
            paragraphs={state.paragraphs}
            onReroll={reroll}
            onAccept={onAccept}
            onRevert={onRevert}
            onEdit={onEdit}
          />
        </div>
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-[10px] text-mute text-center">
        ProseForge · 100% client-side · WebGPU · No data ever leaves your browser
      </footer>
    </div>
  );
}
