import { describe, it, expect } from "vitest";
import { parseGlb, MAX_MODEL_TRIANGLES } from "@/lib/glb";

// --- GLB fixture builder -----------------------------------------------------
// Builds structurally real GLBs: a JSON chunk describing the scene plus a
// BIN chunk sized to match the declared buffer. Accessor counts are what
// the parser measures, so fixtures stay tiny even for "huge" models.

function chunk(type: number, data: Buffer): Buffer {
  const pad = (4 - (data.length % 4)) % 4;
  const out = Buffer.alloc(8 + data.length + pad);
  out.writeUInt32LE(data.length + pad, 0);
  out.writeUInt32LE(type, 4);
  data.copy(out, 8);
  // JSON chunks pad with spaces, BIN with zeros — either parses the same.
  return out;
}

function makeGlb(json: unknown, binBytes = 1024): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const bin = Buffer.alloc(binBytes);
  const body = Buffer.concat([chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, bin)]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

/** One indexed quad-ish mesh: positions accessor + indices accessor. */
function oneMeshJson(overrides: Record<string, unknown> = {}, posCount = 24, indexCount = 36) {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 1024 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 288 },
      { buffer: 0, byteOffset: 288, byteLength: 72 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, type: "VEC3", count: posCount },
      { bufferView: 1, componentType: 5123, type: "SCALAR", count: indexCount },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
}

describe("parseGlb", () => {
  it("measures a valid indexed model", () => {
    const r = parseGlb(makeGlb(oneMeshJson()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.triangles).toBe(12);
    expect(r.stats.vertices).toBe(24);
    expect(r.stats.meshes).toBe(1);
    expect(r.stats.primitives).toBe(1);
    expect(r.stats.textureCount).toBe(0);
  });

  it("counts non-indexed primitives from POSITION counts", () => {
    const json = oneMeshJson();
    delete (json.meshes[0].primitives[0] as Record<string, unknown>).indices;
    const r = parseGlb(makeGlb(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.triangles).toBe(8);
  });

  it("counts textures and their bytes from image bufferViews (deduped)", () => {
    const json = oneMeshJson({
      images: [{ bufferView: 0, mimeType: "image/png" }, { bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }, { source: 1 }],
      materials: [{ pbrMetallicRoughness: {} }],
    });
    const r = parseGlb(makeGlb(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.textureCount).toBe(2);
    expect(r.stats.textureBytes).toBe(288);
    expect(r.stats.materials).toBe(1);
  });

  it("rejects a file whose JSON chunk does not parse", () => {
    const jsonBuf = Buffer.from("{not json", "utf8");
    const body = Buffer.concat([chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, Buffer.alloc(64))]);
    const head = Buffer.alloc(12);
    head.write("glTF", 0, "latin1");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(12 + body.length, 8);
    const r = parseGlb(Buffer.concat([head, body]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/JSON chunk does not parse/);
  });

  it("rejects a non-GLB buffer and a truncated GLB", () => {
    expect(parseGlb(Buffer.from("hello world, not a model")).ok).toBe(false);
    const good = makeGlb(oneMeshJson());
    expect(parseGlb(good.subarray(0, good.length - 10)).ok).toBe(false);
  });

  it("rejects a bufferView that overruns its buffer", () => {
    const json = oneMeshJson();
    (json.bufferViews[0] as Record<string, unknown>).byteLength = 999_999;
    const r = parseGlb(makeGlb(json));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/overruns its buffer/);
  });

  it("rejects a mesh whose POSITION accessor is missing or not VEC3", () => {
    const missing = oneMeshJson();
    (missing.meshes[0].primitives[0].attributes as Record<string, unknown>).POSITION = 99;
    expect(parseGlb(makeGlb(missing)).ok).toBe(false);
    const wrongType = oneMeshJson();
    (wrongType.accessors[0] as Record<string, unknown>).type = "VEC2";
    const r = parseGlb(makeGlb(wrongType));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not VEC3/);
  });

  it("rejects external buffer and image references (GLB must be self-contained)", () => {
    const extBuffer = oneMeshJson({ buffers: [{ byteLength: 1024 }, { byteLength: 10, uri: "geometry.bin" }] });
    expect(parseGlb(makeGlb(extBuffer)).ok).toBe(false);
    const extImage = oneMeshJson({ images: [{ uri: "texture.png" }] });
    const r = parseGlb(makeGlb(extImage));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/external image/);
  });

  it("rejects a model over the triangle limit by declared counts alone", () => {
    const json = oneMeshJson({}, 30, (MAX_MODEL_TRIANGLES + 1) * 3);
    const r = parseGlb(makeGlb(json));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/triangles/);
  });

  it("rejects a model with no meshes", () => {
    const json = oneMeshJson({ meshes: [] });
    const r = parseGlb(makeGlb(json));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no meshes/);
  });
});
