// ============================================================================
// DiffInspector.tsx — Paragraph-by-paragraph side-by-side diff + controls
// ============================================================================

import { useMemo, useState } from "react";
import {
  Check,
  RotateCcw,
  Dice5,
  Pencil,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  MinusCircle,
} from "lucide-react";
import type { ExtractedParagraph } from "../types";
import { computeDiff } from "../utils/diff";

interface Props {
  paragraphs: Map<number, ExtractedParagraph>;
  onReroll: (index: number) => void;
  onAccept: (index: number) => void;
  onRevert: (index: number) => void;
  onEdit: (index: number, newText: string) => void;
}

export function DiffInspector({
  paragraphs,
  onReroll,
  onAccept,
  onRevert,
  onEdit,
}: Props) {
  const items = useMemo(
    () => Array.from(paragraphs.values()).sort((a, b) => a.index - b.index),
    [paragraphs]
  );
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter] = useState<
    "all" | "rewritten" | "flagged" | "skipped"
  >("all");

  const filtered = items.filter((p) => {
    if (filter === "all") return true;
    return p.status === filter;
  });

  const toggle = (i: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const counts = useMemo(() => {
    let rewritten = 0,
      flagged = 0,
      skipped = 0;
    for (const p of items) {
      if (p.status === "rewritten") rewritten++;
      else if (p.status === "flagged") flagged++;
      else if (p.status === "skipped") skipped++;
    }
    return { rewritten, flagged, skipped, total: items.length };
  }, [items]);

  return (
    <section className="bg-bg-panel border border-bg-border rounded-xl">
      <div className="p-4 sm:p-5 border-b border-bg-border flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-200 mr-2">
          Diff Inspector
        </h2>
        <div className="flex gap-1 text-[10px] ml-auto">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={`All ${counts.total}`}
          />
          <FilterChip
            active={filter === "rewritten"}
            onClick={() => setFilter("rewritten")}
            label={`Rewritten ${counts.rewritten}`}
            tone="ok"
          />
          <FilterChip
            active={filter === "flagged"}
            onClick={() => setFilter("flagged")}
            label={`Flagged ${counts.flagged}`}
            tone="warn"
          />
          <FilterChip
            active={filter === "skipped"}
            onClick={() => setFilter("skipped")}
            label={`Skipped ${counts.skipped}`}
            tone="mute"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-xs text-mute">
          Paragraphs will appear here as Agent 4 rewrites them.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border">
          {filtered.map((p) => {
            const isOpen = expanded.has(p.index);
            const diff =
              p.outputText && p.outputText !== p.text
                ? computeDiff(p.text, p.outputText)
                : [];
            return (
              <li key={p.index} className="p-3 sm:p-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(p.index)}
                    className="text-mute hover:text-zinc-100"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                  <StatusBadge status={p.status} />
                  <span className="text-[11px] text-mute font-mono">
                    ¶{p.index + 1} ·{" "}
                    {p.metrics ? `${p.metrics.wordCount}w` : "—"}
                    {p.llmPasses ? ` · ${p.llmPasses}x` : ""}
                  </span>
                  {p.flagReason && (
                    <span
                      className="text-[10px] text-warn truncate max-w-[40%]"
                      title={p.flagReason}
                    >
                      ⚠ {p.flagReason}
                    </span>
                  )}
                  <div className="ml-auto flex gap-1">
                    <IconBtn
                      title="Re-roll paragraph"
                      onClick={() => onReroll(p.index)}
                    >
                      <Dice5 className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      title="Accept rewrite"
                      tone="ok"
                      onClick={() => onAccept(p.index)}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      title="Revert to original"
                      onClick={() => onRevert(p.index)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      title="Manually edit"
                      onClick={() => {
                        setEditing(p.index);
                        setEditText(p.outputText);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </IconBtn>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-mute uppercase tracking-wider mb-1">
                        Original (sanitized)
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed bg-bg-base border border-bg-border rounded-md p-3 max-h-64 overflow-y-auto">
                        {p.text}
                      </p>
                    </div>
                    <div>
                      <div className="text-[10px] text-mute uppercase tracking-wider mb-1">
                        Rewritten
                      </div>
                      {editing === p.index ? (
                        <div>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full h-40 bg-bg-base border border-accent rounded-md p-3 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                          />
                          <div className="flex gap-1 mt-1">
                            <button
                              onClick={() => {
                                onEdit(p.index, editText);
                                setEditing(null);
                              }}
                              className="text-[10px] px-2 py-1 rounded bg-accent text-white"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="text-[10px] px-2 py-1 rounded border border-bg-border text-mute"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs leading-relaxed bg-bg-base border border-bg-border rounded-md p-3 max-h-64 overflow-y-auto">
                          {diff.length > 0 ? (
                            diff.map((seg, i) => (
                              <span
                                key={i}
                                className={
                                  seg.added
                                    ? "bg-ok/15 text-ok"
                                    : seg.removed
                                    ? "bg-err/15 text-err line-through"
                                    : "text-zinc-200"
                                }
                              >
                                {seg.value}
                              </span>
                            ))
                          ) : (
                            <span className="text-zinc-300">{p.outputText}</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: ExtractedParagraph["status"] }) {
  const map: Record<
    ExtractedParagraph["status"],
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    pending: {
      label: "Pending",
      cls: "text-mute border-bg-border",
      icon: <MinusCircle className="w-3 h-3" />,
    },
    skipped: {
      label: "Skipped",
      cls: "text-mute border-bg-border",
      icon: <MinusCircle className="w-3 h-3" />,
    },
    rewritten: {
      label: "Rewritten",
      cls: "text-ok border-ok/30 bg-ok/5",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    flagged: {
      label: "Flagged",
      cls: "text-warn border-warn/30 bg-warn/5",
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    rerun: {
      label: "Re-run",
      cls: "text-accent-glow border-accent/30 bg-accent/5",
      icon: <Dice5 className="w-3 h-3" />,
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${s.cls}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  tone?: "default" | "ok";
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded border border-bg-border hover:border-zinc-600 ${
        tone === "ok" ? "text-ok hover:bg-ok/10" : "text-mute hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: "default" | "ok" | "warn" | "mute";
}) {
  const toneCls =
    tone === "ok"
      ? "text-ok border-ok/30"
      : tone === "warn"
      ? "text-warn border-warn/30"
      : tone === "mute"
      ? "text-mute border-bg-border"
      : "text-accent-glow border-accent/30";
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
        active ? toneCls + " bg-bg-elevated" : "text-mute border-bg-border"
      }`}
    >
      {label}
    </button>
  );
}
