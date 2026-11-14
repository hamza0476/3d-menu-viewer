// Deep GLB parsing for the Phase 4 model pipeline (fixes G4).
//
// Phase 2's upload gate (media-validation.ts) checks the GLB header only:
// magic, version, declared length. That is enough to accept a file for
// storage, but the pipeline needs to know what is INSIDE before it trusts
// a worker with it and before it tells an owner anything about quality.
// This module parses the real structure — header, JSON chunk, BIN chunk,
// buffers, bufferViews, accessors, meshes, images — validates the
// cross-references between them, and measures the model (triangles,
// vertices, textures) from the file's own declarations.
//
// Why hand-rolled: the numbers the pipeline needs live in accessor counts
// and bufferView lengths; a full glTF scene-graph loader (three's
// GLTFLoader) needs a DOM/WebGL context and pulls the whole runtime into
// a server worker. This parser is pure buffer arithmetic, has no
// dependencies, and fails with a human-readable reason the owner can see
// on the failed job — a corrupt GLB fails the JOB here, never the worker.

import { isValidGlb } from "./media-validation";

const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

export const MAX_MODEL_TRIANGLES = 5_000_000;
export const MAX_MODEL_ACCESSORS = 100_000;

export type GlbStats = {
  triangles: number;
  vertices: number;
  meshes: number;
  primitives: number;
  materials: number;
  nodes: number;
  animations: number;
  textureCount: number;
  textureBytes: number;
  imageCount: number;
  extensionsUsed: string[];
};

export type GlbParseResult =
  | { ok: true; stats: GlbStats }
  | { ok: false; error: string };

type Json = Record<string, unknown>;

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const COMPONENT_TYPES = new Set([5120, 5121, 5122, 5123, 5125, 5126]);
const ACCESSOR_TYPES = new Set(["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"]);
const INDEX_COMPONENT_TYPES = new Set([5121, 5123, 5125]);

/** Parse + structurally validate a GLB and measure it. Never throws. */
export function parseGlb(buffer: Buffer): GlbParseResult {
  try {
    return parseGlbInner(buffer);
  } catch (e) {
    return { ok: false, error: `Unparseable GLB: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function parseGlbInner(buffer: Buffer): GlbParseResult {
  if (!isValidGlb(buffer)) return { ok: false, error: "Not a valid GLB file (bad header, version, or length)." };

  // --- chunk walk -----------------------------------------------------------
  let offset = 12;
  let json: Json | null = null;
  let binLength: number | null = null;
  let chunkIndex = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) return { ok: false, error: "Truncated chunk header." };
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    if (chunkLength % 4 !== 0) return { ok: false, error: "Chunk length is not 4-byte aligned." };
    if (offset + 8 + chunkLength > buffer.length) return { ok: false, error: "Chunk overruns the end of the file." };
    if (chunkIndex === 0) {
      if (chunkType !== JSON_CHUNK) return { ok: false, error: "First chunk is not the JSON chunk." };
      try {
        // Chunk data is padded to 4 bytes — spaces per spec, but some
        // writers pad with NULs; strip both before parsing.
        const text = buffer.toString("utf8", offset + 8, offset + 8 + chunkLength).replace(/[\u0000\s]+$/, "");
        json = JSON.parse(text) as Json;
      } catch {
        return { ok: false, error: "The GLB's JSON chunk does not parse." };
      }
    } else if (chunkType === BIN_CHUNK) {
      if (binLength !== null) return { ok: false, error: "More than one binary chunk." };
      binLength = chunkLength;
    }
    offset += 8 + chunkLength;
    chunkIndex++;
  }
  if (!json) return { ok: false, error: "Missing JSON chunk." };
  if (offset !== buffer.length) return { ok: false, error: "Trailing bytes after the last chunk." };

  const asset = json.asset;
  if (!isObj(asset) || typeof asset.version !== "string" || !asset.version.startsWith("2")) {
    return { ok: false, error: "Missing or unsupported glTF asset version (need 2.x)." };
  }

  // --- buffers & bufferViews -------------------------------------------------
  const buffers = arr(json.buffers);
  if (buffers.length === 0) return { ok: false, error: "The model declares no buffers." };
  for (const [i, raw] of buffers.entries()) {
    if (!isObj(raw) || typeof raw.byteLength !== "number" || raw.byteLength < 0) {
      return { ok: false, error: `Buffer ${i} has no valid byteLength.` };
    }
    if (i === 0 && binLength !== null) {
      if (typeof raw.uri === "string") return { ok: false, error: "Buffer 0 has both a URI and a binary chunk." };
      if (raw.byteLength > binLength) return { ok: false, error: "Buffer 0 is larger than the binary chunk that should hold it." };
    }
    if (i > 0 && typeof raw.uri !== "string") {
      return { ok: false, error: `Buffer ${i} has no URI — only buffer 0 may live in the binary chunk.` };
    }
    if (typeof raw.uri === "string" && !raw.uri.startsWith("data:")) {
      return { ok: false, error: "The model references an external buffer file — a GLB must be self-contained." };
    }
  }
  if (binLength === null && typeof (buffers[0] as Json).uri !== "string") {
    return { ok: false, error: "No binary chunk and buffer 0 has no data URI — the geometry has no home." };
  }
  const bufferViews = arr(json.bufferViews);
  for (const [i, raw] of bufferViews.entries()) {
    if (!isObj(raw)) return { ok: false, error: `BufferView ${i} is malformed.` };
    const bufferIndex = raw.buffer ?? 0;
    if (typeof bufferIndex !== "number" || bufferIndex < 0 || bufferIndex >= buffers.length) {
      return { ok: false, error: `BufferView ${i} points at a missing buffer.` };
    }
    const byteLength = raw.byteLength;
    const byteOffset = typeof raw.byteOffset === "number" ? raw.byteOffset : 0;
    const declared = (buffers[bufferIndex] as Json).byteLength as number;
    if (typeof byteLength !== "number" || byteLength < 0 || byteOffset < 0 || byteOffset + byteLength > declared) {
      return { ok: false, error: `BufferView ${i} overruns its buffer.` };
    }
  }

  // --- accessors ---------------------------------------------------------------
  const accessors = arr(json.accessors);
  if (accessors.length > MAX_MODEL_ACCESSORS) return { ok: false, error: `Too many accessors (${accessors.length}).` };
  for (const [i, raw] of accessors.entries()) {
    if (!isObj(raw)) return { ok: false, error: `Accessor ${i} is malformed.` };
    if (!COMPONENT_TYPES.has(raw.componentType as number)) return { ok: false, error: `Accessor ${i} has an unknown componentType.` };
    if (!ACCESSOR_TYPES.has(raw.type as string)) return { ok: false, error: `Accessor ${i} has an unknown type.` };
    if (typeof raw.count !== "number" || raw.count < 0) return { ok: false, error: `Accessor ${i} has an invalid count.` };
    if (raw.bufferView !== undefined) {
      if (typeof raw.bufferView !== "number" || raw.bufferView < 0 || raw.bufferView >= bufferViews.length) {
        return { ok: false, error: `Accessor ${i} points at a missing bufferView.` };
      }
    }
  }
  const accessorAt = (i: unknown): Json | null =>
    typeof i === "number" && i >= 0 && i < accessors.length ? (accessors[i] as Json) : null;

  // --- meshes: triangle + vertex counts ---------------------------------------
  const meshes = arr(json.meshes);
  if (meshes.length === 0) return { ok: false, error: "The model contains no meshes." };
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const [mi, rawMesh] of meshes.entries()) {
    if (!isObj(rawMesh)) return { ok: false, error: `Mesh ${mi} is malformed.` };
    const prims = arr(rawMesh.primitives);
    if (prims.length === 0) return { ok: false, error: `Mesh ${mi} has no primitives.` };
    for (const rawPrim of prims) {
      if (!isObj(rawPrim) || !isObj(rawPrim.attributes)) return { ok: false, error: `Mesh ${mi} has a primitive without attributes.` };
      const pos = accessorAt(rawPrim.attributes.POSITION);
      if (!pos) return { ok: false, error: `Mesh ${mi} has a primitive without a valid POSITION accessor.` };
      if (pos.type !== "VEC3") return { ok: false, error: `Mesh ${mi}'s POSITION accessor is not VEC3.` };
      const posCount = pos.count as number;
      vertices += posCount;
      if (rawPrim.indices !== undefined) {
        const idx = accessorAt(rawPrim.indices);
        if (!idx) return { ok: false, error: `Mesh ${mi} has an invalid indices accessor.` };
        if (idx.type !== "SCALAR" || !INDEX_COMPONENT_TYPES.has(idx.componentType as number)) {
          return { ok: false, error: `Mesh ${mi}'s indices accessor is not an unsigned index type.` };
        }
        triangles += Math.floor((idx.count as number) / 3);
      } else {
        triangles += Math.floor(posCount / 3);
      }
      primitives++;
    }
  }
  if (triangles > MAX_MODEL_TRIANGLES) {
    return { ok: false, error: `The model has ${triangles.toLocaleString("en-US")} triangles — the limit is ${MAX_MODEL_TRIANGLES.toLocaleString("en-US")}. Simplify it before uploading.` };
  }

  // --- images / textures ---------------------------------------------------------
  const images = arr(json.images);
  let textureBytes = 0;
  const seenViews = new Set<number>();
  for (const [i, raw] of images.entries()) {
    if (!isObj(raw)) return { ok: false, error: `Image ${i} is malformed.` };
    if (raw.bufferView !== undefined) {
      if (typeof raw.bufferView !== "number" || raw.bufferView < 0 || raw.bufferView >= bufferViews.length) {
        return { ok: false, error: `Image ${i} points at a missing bufferView.` };
      }
      if (!seenViews.has(raw.bufferView)) {
        seenViews.add(raw.bufferView);
        textureBytes += (bufferViews[raw.bufferView] as Json).byteLength as number;
      }
    } else if (typeof raw.uri === "string" && !raw.uri.startsWith("data:")) {
      return { ok: false, error: "The model references an external image file — a GLB must be self-contained." };
    }
  }
  const textures = arr(json.textures);

  return {
    ok: true,
    stats: {
      triangles,
      vertices,
      meshes: meshes.length,
      primitives,
      materials: arr(json.materials).length,
      nodes: arr(json.nodes).length,
      animations: arr(json.animations).length,
      textureCount: textures.length > 0 ? textures.length : images.length,
      textureBytes,
      imageCount: images.length,
      extensionsUsed: arr(json.extensionsUsed).filter((e): e is string => typeof e === "string"),
    },
  };
}
