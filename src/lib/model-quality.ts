// Per-item 3D quality grading for owners (Phase 4, part of the G4 fix).
//
// Every grade is computed from values the pipeline MEASURED in the file
// (accessor counts, stored byte sizes) — never from anything the uploader
// claimed. Thresholds come from the master plan's pipeline targets:
// guests are mostly on low/mid Android phones on 4G, the low variant is
// what loads first (target ≤ 3–5 MB), the high variant is the desktop /
// fast-connection upgrade (target ≤ ~15 MB), and texture memory is the
// usual reason a phone GPU chokes, so texture bytes are graded on their
// own. "good / ok / poor" is deliberately coarse — this is a guide for a
// restaurant owner, not an engineering audit.

export type Grade = "good" | "ok" | "poor";

export type QualityCheck = {
  key: string;
  label: string;
  grade: Grade;
  detail: string;
};

export type ModelQualityInput = {
  triangleCount: number | null;
  sourceBytes: number | null;
  highBytes: number | null;
  lowBytes: number | null;
  textureCount: number | null;
  textureBytes: number | null;
  hasHigh: boolean;
  hasLow: boolean;
  hasUsdz: boolean;
  hasPoster: boolean;
  processor: string | null;
};

const MB = 1024 * 1024;

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(2)} MB`;
}

function worst(grades: Grade[]): Grade {
  if (grades.includes("poor")) return "poor";
  if (grades.includes("ok")) return "ok";
  return "good";
}

export function gradeModel(input: ModelQualityInput): { overall: Grade; checks: QualityCheck[] } {
  const checks: QualityCheck[] = [];

  if (input.triangleCount !== null) {
    const t = input.triangleCount;
    checks.push({
      key: "triangles",
      label: "Triangles",
      grade: t <= 150_000 ? "good" : t <= 500_000 ? "ok" : "poor",
      detail: `${t.toLocaleString("en-US")} triangles${t > 500_000 ? " — simplify the model to keep phones smooth" : ""}`,
    });
  }

  if (input.lowBytes !== null) {
    const mb = input.lowBytes / MB;
    checks.push({
      key: "low-size",
      label: "Guest download (low variant)",
      grade: mb <= 3 ? "good" : mb <= 5 ? "ok" : "poor",
      detail: `${formatBytes(input.lowBytes)} — the first file a guest's phone loads${mb > 5 ? "; over the 5 MB target for 4G" : ""}`,
    });
  }

  if (input.highBytes !== null) {
    const mb = input.highBytes / MB;
    checks.push({
      key: "high-size",
      label: "Detail download (high variant)",
      grade: mb <= 15 ? "good" : "ok",
      detail: `${formatBytes(input.highBytes)} — loaded only on fast connections / desktop`,
    });
  }

  if (input.textureBytes !== null && input.textureCount !== null) {
    const mb = input.textureBytes / MB;
    checks.push({
      key: "textures",
      label: "Textures",
      grade: mb <= 4 ? "good" : mb <= 10 ? "ok" : "poor",
      detail: `${input.textureCount} texture${input.textureCount === 1 ? "" : "s"}, ${formatBytes(input.textureBytes)}${mb > 10 ? " — large textures strain phone GPUs" : ""}`,
    });
  }

  const variantBits: string[] = [];
  if (input.hasLow) variantBits.push("low");
  if (input.hasHigh) variantBits.push("high");
  if (input.hasUsdz) variantBits.push("USDZ for iPhone AR");
  if (input.hasPoster) variantBits.push("poster");
  checks.push({
    key: "variants",
    label: "Variants ready",
    grade: input.hasLow && input.hasHigh ? "good" : input.hasLow || input.hasHigh ? "ok" : "poor",
    detail: variantBits.length ? variantBits.join(" · ") : "No variants produced yet",
  });

  if (input.processor) {
    checks.push({
      key: "processor",
      label: "Optimisation",
      grade: input.processor === "passthrough" ? "ok" : "good",
      detail:
        input.processor === "passthrough"
          ? "Variants are unoptimised copies of the source — no optimiser is configured on this server yet"
          : `Produced by the configured external processor (${input.processor})`,
    });
  }

  return { overall: checks.length ? worst(checks.map((c) => c.grade)) : "ok", checks };
}
