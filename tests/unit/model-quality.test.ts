import { describe, it, expect } from "vitest";
import { gradeModel, formatBytes, type ModelQualityInput } from "@/lib/model-quality";

const base: ModelQualityInput = {
  triangleCount: 42_000,
  sourceBytes: 8 * 1024 * 1024,
  highBytes: 8 * 1024 * 1024,
  lowBytes: 2 * 1024 * 1024,
  textureCount: 3,
  textureBytes: 2 * 1024 * 1024,
  hasHigh: true,
  hasLow: true,
  hasUsdz: false,
  hasPoster: false,
  processor: "external",
};

describe("gradeModel", () => {
  it("grades a healthy model good overall", () => {
    const q = gradeModel(base);
    expect(q.overall).toBe("good");
    expect(q.checks.find((c) => c.key === "triangles")?.grade).toBe("good");
  });

  it("flags an oversized low variant as poor (it is what guests download first)", () => {
    const q = gradeModel({ ...base, lowBytes: 9 * 1024 * 1024 });
    expect(q.checks.find((c) => c.key === "low-size")?.grade).toBe("poor");
    expect(q.overall).toBe("poor");
  });

  it("flags heavy geometry and textures", () => {
    const q = gradeModel({ ...base, triangleCount: 900_000, textureBytes: 30 * 1024 * 1024 });
    expect(q.checks.find((c) => c.key === "triangles")?.grade).toBe("poor");
    expect(q.checks.find((c) => c.key === "textures")?.grade).toBe("poor");
  });

  it("is honest about passthrough: variants exist but optimisation grades only ok", () => {
    const q = gradeModel({ ...base, processor: "passthrough" });
    const opt = q.checks.find((c) => c.key === "processor");
    expect(opt?.grade).toBe("ok");
    expect(opt?.detail).toMatch(/unoptimised copies/);
  });

  it("grades missing variants poor and partial variants ok", () => {
    expect(gradeModel({ ...base, hasLow: false, hasHigh: false }).checks.find((c) => c.key === "variants")?.grade).toBe("poor");
    expect(gradeModel({ ...base, hasLow: false }).checks.find((c) => c.key === "variants")?.grade).toBe("ok");
  });

  it("omits checks for values the pipeline did not measure", () => {
    const q = gradeModel({ ...base, triangleCount: null, textureBytes: null, textureCount: null });
    expect(q.checks.some((c) => c.key === "triangles")).toBe(false);
    expect(q.checks.some((c) => c.key === "textures")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats sizes for owners", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});
