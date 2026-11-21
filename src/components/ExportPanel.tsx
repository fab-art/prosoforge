// ============================================================================
// ExportPanel.tsx — Download rebuilt .docx + optional audit report
// ============================================================================

import { Download, FileCheck2, FileJson, FileText } from "lucide-react";
import type { AuditReport } from "../types";

interface Props {
  finalDocx: { blob: Blob; filename: string } | null;
  auditReport: AuditReport | null;
}

export function ExportPanel({ finalDocx, auditReport }: Props) {
  if (!finalDocx) return null;

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadJson = () => {
    if (!auditReport) return;
    const blob = new Blob([JSON.stringify(auditReport, null, 2)], {
      type: "application/json",
    });
    download(blob, auditReport.filename.replace(/\.docx$/i, "") + ".audit.json");
  };

  const downloadMd = () => {
    if (!auditReport) return;
    download(
      new Blob([buildMdReport(auditReport)], { type: "text/markdown" }),
      auditReport.filename.replace(/\.docx$/i, "") + ".audit.md"
    );
  };

  return (
    <section className="bg-ok/5 border border-ok/30 rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileCheck2 className="w-5 h-5 text-ok" />
        <h2 className="text-sm font-semibold text-zinc-100">
          Pipeline complete — ready to export
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          onClick={() => download(finalDocx.blob, finalDocx.filename)}
          className="flex items-center justify-center gap-2 py-3 rounded-md bg-ok hover:bg-ok/90 text-bg-base text-sm font-semibold"
        >
          <Download className="w-4 h-4" />
          Download .docx
        </button>
        <button
          onClick={downloadJson}
          disabled={!auditReport}
          className="flex items-center justify-center gap-2 py-3 rounded-md bg-bg-elevated border border-bg-border hover:border-accent text-sm text-zinc-200 disabled:opacity-40"
        >
          <FileJson className="w-4 h-4" />
          Audit .json
        </button>
        <button
          onClick={downloadMd}
          disabled={!auditReport}
          className="flex items-center justify-center gap-2 py-3 rounded-md bg-bg-elevated border border-bg-border hover:border-accent text-sm text-zinc-200 disabled:opacity-40"
        >
          <FileText className="w-4 h-4" />
          Audit .md
        </button>
      </div>
      {auditReport && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
          <MiniStat label="Paragraphs" value={auditReport.totalParagraphs.toString()} />
          <MiniStat label="Rewritten" value={auditReport.rewritten.toString()} tone="ok" />
          <MiniStat label="Skipped" value={auditReport.skipped.toString()} tone="mute" />
          <MiniStat label="Flagged" value={auditReport.flagged.toString()} tone="warn" />
          <MiniStat
            label="Citations verified"
            value={`${auditReport.citationsVerified}/${auditReport.citationsLocked}`}
            tone="ok"
          />
        </div>
      )}
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "mute";
}) {
  const color =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
      ? "text-warn"
      : tone === "mute"
      ? "text-mute"
      : "text-zinc-100";
  return (
    <div className="bg-bg-base border border-bg-border rounded-md p-2">
      <div className="text-[9px] text-mute uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function buildMdReport(r: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# ProseForge Audit Report`);
  lines.push("");
  lines.push(`- **File:** \`${r.filename}\``);
  lines.push(`- **Generated:** ${r.generatedAt}`);
  lines.push(`- **Model:** \`${r.modelId}\``);
  lines.push(`- **Intensity:** ${r.intensity}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total paragraphs | ${r.totalParagraphs} |`);
  lines.push(`| Rewritten | ${r.rewritten} |`);
  lines.push(`| Skipped (human bursty / too short) | ${r.skipped} |`);
  lines.push(`| Flagged for manual review | ${r.flagged} |`);
  lines.push(`| Citations locked | ${r.citationsLocked} |`);
  lines.push(`| Citations verified | ${r.citationsVerified} |`);
  lines.push(`| Avg burstiness Δ | +${r.avgBurstinessDelta.toFixed(2)} |`);
  lines.push(`| Avg AI-tell reduction | ${r.avgAiTellReduction.toFixed(2)} |`);
  lines.push("");
  lines.push("## Per-paragraph detail");
  lines.push("");
  for (const p of r.paragraphs) {
    lines.push(`### ¶${p.index + 1} — ${p.status}${p.auditPassed === false ? " ⚠" : ""}`);
    if (p.flagReason) lines.push(`> **Flag reason:** ${p.flagReason}`);
    lines.push("");
    lines.push(`**Before:**`);
    lines.push("");
    lines.push("> " + p.before.replace(/\n/g, " "));
    lines.push("");
    lines.push(`**After:**`);
    lines.push("");
    lines.push("> " + p.after.replace(/\n/g, " "));
    lines.push("");
    if (p.metrics) {
      lines.push(
        `<details><summary>Metrics</summary>words: ${p.metrics.wordCount} · sentences: ${p.metrics.sentenceCount} · stddev: ${p.metrics.sentenceLengthStdDev.toFixed(2)} · passive: ${(p.metrics.passiveRatio * 100).toFixed(0)}% · AI clichés: ${p.metrics.aiClicheCount}</details>`
      );
      lines.push("");
    }
  }
  return lines.join("\n");
}
