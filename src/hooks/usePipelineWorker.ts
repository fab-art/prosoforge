// ============================================================================
// usePipelineWorker.ts — React hook bridging UI <-> pipelineWorker
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkerRequest,
  WorkerResponse,
  ModelId,
  RewriteIntensity,
  ExtractedParagraph,
  AgentStage,
  AuditReport,
} from "../types";

export interface PipelineState {
  gpuSupported: boolean | null;
  gpuReason?: string;
  modelId: ModelId | null;
  modelReady: boolean;
  modelProgress: number;
  modelProgressText: string;
  vramMB: number;
  stage: AgentStage;
  docStats: {
    totalWords: number;
    totalParagraphs: number;
    citationsLocked: number;
    estimatedSeconds: number;
  } | null;
  paragraphs: Map<number, ExtractedParagraph>;
  telemetry: {
    processed: number;
    total: number;
    burstinessDelta: number;
    aiTellReduction: number;
  } | null;
  paused: boolean;
  logs: { message: string; level: "info" | "warn" | "error"; t: number }[];
  finalDocx: { blob: Blob; filename: string } | null;
  auditReport: AuditReport | null;
  error: string | null;
}

const initialState: PipelineState = {
  gpuSupported: null,
  modelId: null,
  modelReady: false,
  modelProgress: 0,
  modelProgressText: "",
  vramMB: 0,
  stage: "idle",
  docStats: null,
  paragraphs: new Map(),
  telemetry: null,
  paused: false,
  logs: [],
  finalDocx: null,
  auditReport: null,
  error: null,
};

export function usePipelineWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<PipelineState>(initialState);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL("../workers/pipelineWorker.ts", import.meta.url),
        { type: "module" }
      );
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        setState((prev) => {
          const next = { ...prev };
          switch (msg.type) {
            case "gpu":
              next.gpuSupported = msg.supported;
              next.gpuReason = msg.reason;
              break;
            case "log":
              next.logs = [
                ...prev.logs.slice(-200),
                { message: msg.message, level: msg.level ?? "info", t: Date.now() },
              ];
              break;
            case "modelProgress":
              next.modelProgress = msg.progress;
              next.modelProgressText = msg.text;
              break;
            case "modelReady":
              next.modelReady = true;
              next.modelId = msg.modelId;
              next.vramMB = msg.vramMB;
              next.modelProgress = 1;
              next.modelProgressText = "Ready";
              break;
            case "docStats":
              next.docStats = {
                totalWords: msg.totalWords,
                totalParagraphs: msg.totalParagraphs,
                citationsLocked: msg.citationsLocked,
                estimatedSeconds: msg.estimatedSeconds,
              };
              break;
            case "stage":
              next.stage = msg.stage;
              break;
            case "paragraphUpdate": {
              const m = new Map(prev.paragraphs);
              m.set(msg.index, msg.paragraph);
              next.paragraphs = m;
              break;
            }
            case "telemetry":
              next.telemetry = {
                processed: msg.processed,
                total: msg.total,
                burstinessDelta: msg.burstinessDelta,
                aiTellReduction: msg.aiTellReduction,
              };
              break;
            case "paused":
              next.paused = true;
              break;
            case "resumed":
              next.paused = false;
              break;
            case "cancelled":
              next.paused = false;
              next.stage = "idle";
              break;
            case "complete": {
              const blob = new Blob([msg.docxBlob], {
                type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              });
              next.finalDocx = {
                blob,
                filename: msg.auditReport.filename.replace(/\.docx$/i, "") + ".sanitized.docx",
              };
              next.auditReport = msg.auditReport;
              next.stage = "complete";
              break;
            }
            case "error":
              next.error = msg.message;
              break;
          }
          return next;
        });
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    ensureWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [ensureWorker]);

  const send = useCallback(
    (msg: WorkerRequest) => {
      const w = ensureWorker();
      w.postMessage(msg);
    },
    [ensureWorker]
  );

  const initModel = useCallback(
    (modelId: ModelId, intensity: RewriteIntensity, styleSample?: string, glossaryTerms?: string[]) => {
      setState((p) => ({ ...p, modelReady: false, modelProgress: 0, modelProgressText: "Starting...", modelId }));
      send({ type: "init", modelId, intensity, styleSample, glossaryTerms });
    },
    [send]
  );

  const processDocx = useCallback(
    (
      docxBlob: ArrayBuffer,
      filename: string,
      intensity: RewriteIntensity,
      styleSample?: string,
      glossaryTerms?: string[]
    ) => {
      setState((p) => ({
        ...p,
        finalDocx: null,
        auditReport: null,
        error: null,
        paragraphs: new Map(),
        telemetry: null,
      }));
      send({ type: "process", docxBlob, filename, intensity, styleSample, glossaryTerms });
    },
    [send]
  );

  const pause = useCallback(() => send({ type: "pause" }), [send]);
  const resume = useCallback(() => send({ type: "resume" }), [send]);
  const cancel = useCallback(() => send({ type: "cancel" }), [send]);
  const reroll = useCallback(
    (paragraphIndex: number) => send({ type: "reroll", paragraphIndex }),
    [send]
  );
  const clearModel = useCallback(() => send({ type: "clearModel" }), [send]);
  const restoreCheckpoint = useCallback(
    (filename: string) => send({ type: "restoreCheckpoint", filename }),
    [send]
  );
  const resumeProcessing = useCallback(
    (filename: string) => send({ type: "resumeProcessing", filename }),
    [send]
  );

  const clearError = useCallback(
    () => setState((p) => ({ ...p, error: null })),
    []
  );

  return {
    state,
    initModel,
    processDocx,
    pause,
    resume,
    cancel,
    reroll,
    clearModel,
    restoreCheckpoint,
    resumeProcessing,
    clearError,
  };
}
