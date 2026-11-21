// ============================================================================
// SetupDrawer.tsx — Upload, stats, style sample, glossary, intensity
// ============================================================================

import { useRef, useState } from "react";
import {
  Upload,
  FileText,
  Clock,
  Hash,
  Lock,
  ChevronDown,
  ChevronRight,
  Tag,
  Gauge,
} from "lucide-react";
import type { RewriteIntensity } from "../types";

interface DocStats {
  totalWords: number;
  totalParagraphs: number;
  citationsLocked: number;
  estimatedSeconds: number;
}

interface Props {
  onUpload: (file: File) => void;
  docStats: DocStats | null;
  filename: string | null;
  intensity: RewriteIntensity;
  onIntensityChange: (i: RewriteIntensity) => void;
  styleSample: string;
  onStyleSampleChange: (s: string) => void;
  glossaryTerms: string[];
  onGlossaryChange: (terms: string[]) => void;
  onStart: () => void;
  canStart: boolean;
  processing: boolean;
}

const INTENSITY_OPTIONS: {
  value: RewriteIntensity;
  label: string;
  hint: string;
}[] = [
  { value: "conservative", label: "Conservative", hint: "Light edits, low risk" },
  { value: "balanced", label: "Balanced", hint: "Structural rewrite, default" },
  { value: "deep", label: "Deep Structural", hint: "Aggressive reordering" },
];

export function SetupDrawer(props: Props) {
  const {
    onUpload,
    docStats,
    filename,
    intensity,
    onIntensityChange,
    styleSample,
    onStyleSampleChange,
    glossaryTerms,
    onGlossaryChange,
    onStart,
    canStart,
    processing,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".docx")) {
      onUpload(file);
    }
  };

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !glossaryTerms.includes(t)) {
      onGlossaryChange([...glossaryTerms, t]);
    }
    setTagInput("");
  };

  return (
    <section className="bg-bg-panel border border-bg-border rounded-xl p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
        <Upload className="w-4 h-4 text-accent" />
        Document & Calibration
      </h2>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-accent bg-accent/5"
            : "border-bg-border hover:border-zinc-600"
        }`}
      >
        <FileText className="w-8 h-8 mx-auto mb-2 text-mute" />
        <p className="text-sm text-zinc-300">
          {filename ? (
            <>
              <span className="text-accent-glow">{filename}</span> loaded
            </>
          ) : (
            "Drag & drop your .docx here"
          )}
        </p>
        <p className="text-[11px] text-mute mt-1">
          or click to browse — 100% processed in your browser, never uploaded
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }}
        />
      </div>

      {/* Stats */}
      {docStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat
            icon={<FileText className="w-3 h-3" />}
            label="Paragraphs"
            value={docStats.totalParagraphs.toString()}
          />
          <Stat
            icon={<Hash className="w-3 h-3" />}
            label="Words"
            value={docStats.totalWords.toLocaleString()}
          />
          <Stat
            icon={<Lock className="w-3 h-3" />}
            label="Citations Locked"
            value={docStats.citationsLocked.toString()}
          />
          <Stat
            icon={<Clock className="w-3 h-3" />}
            label="Est. Time"
            value={
              docStats.estimatedSeconds < 60
                ? `${docStats.estimatedSeconds}s`
                : `${Math.ceil(docStats.estimatedSeconds / 60)}m`
            }
          />
        </div>
      )}

      {/* Intensity */}
      <div className="mt-4">
        <label className="text-xs text-zinc-300 flex items-center gap-1.5 mb-2">
          <Gauge className="w-3.5 h-3.5 text-accent" />
          Rewrite Intensity
        </label>
        <div className="grid grid-cols-3 gap-2">
          {INTENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={processing}
              onClick={() => onIntensityChange(opt.value)}
              className={`text-xs px-2 py-2 rounded-md border transition-colors disabled:opacity-50 ${
                intensity === opt.value
                  ? "border-accent bg-accent/10 text-accent-glow"
                  : "border-bg-border text-zinc-300 hover:border-zinc-600"
              }`}
              title={opt.hint}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-[9px] text-mute mt-0.5">{opt.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Author style sample */}
      <div className="mt-4">
        <button
          onClick={() => setShowStyle(!showStyle)}
          className="w-full flex items-center justify-between text-xs text-zinc-300 hover:text-zinc-100"
        >
          <span className="flex items-center gap-1.5">
            {showStyle ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Author Style Sample (optional, 200–400 words)
          </span>
          <span className="text-[10px] text-mute">
            {styleSample.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </button>
        {showStyle && (
          <textarea
            value={styleSample}
            onChange={(e) => onStyleSampleChange(e.target.value)}
            placeholder="Paste 200–400 words of your own unassisted writing. Agent 3 will profile your burstiness, passive-voice ratio, and sentence-length stddev to clone your voice."
            className="mt-2 w-full h-32 bg-bg-base border border-bg-border rounded-md p-3 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-accent resize-y font-mono"
          />
        )}
      </div>

      {/* Glossary */}
      <div className="mt-4">
        <button
          onClick={() => setShowGlossary(!showGlossary)}
          className="w-full flex items-center justify-between text-xs text-zinc-300 hover:text-zinc-100"
        >
          <span className="flex items-center gap-1.5">
            {showGlossary ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Locked Glossary Terms (optional)
          </span>
          <span className="text-[10px] text-mute">
            {glossaryTerms.length} terms
          </span>
        </button>
        {showGlossary && (
          <div className="mt-2">
            <div className="flex gap-1.5">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="e.g. Bevacizumab, RNA-seq, CRISPR-Cas9"
                className="flex-1 bg-bg-base border border-bg-border rounded-md px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={handleAddTag}
                className="px-3 py-1.5 text-xs bg-bg-elevated border border-bg-border rounded-md hover:border-accent flex items-center gap-1"
              >
                <Tag className="w-3 h-3" /> Add
              </button>
            </div>
            {glossaryTerms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {glossaryTerms.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] bg-accent/10 border border-accent/30 text-accent-glow px-2 py-0.5 rounded-full flex items-center gap-1"
                  >
                    {t}
                    <button
                      onClick={() =>
                        onGlossaryChange(glossaryTerms.filter((x) => x !== t))
                      }
                      className="text-accent-glow/60 hover:text-err"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Start */}
      <button
        onClick={onStart}
        disabled={!canStart}
        className="mt-5 w-full py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {processing ? "Processing..." : "Run Pipeline"}
      </button>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-bg-base border border-bg-border rounded-md p-2.5">
      <div className="flex items-center gap-1 text-[10px] text-mute uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold text-zinc-100 mt-1">{value}</div>
    </div>
  );
}
