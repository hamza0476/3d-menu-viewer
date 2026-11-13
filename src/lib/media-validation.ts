// Upload validation by CONTENT, never by client-supplied metadata (fixes S5).
//
// Before Phase 2, image uploads were trusted on the browser's MIME type
// alone — only GLB files got a magic-byte check. Now every upload is
// sniffed from its own bytes: a file is a JPEG/PNG/WebP/GLB because its
// bytes say so, or it is rejected. That kills the classic polyglot tricks
// (HTML/SVG/GIF renamed to .png) at the door. The sniffed type — not the
// client's — decides the stored MIME, and images must additionally parse
// structurally far enough to yield real dimensions, which corrupt or
// truncated files cannot do.
//
// What this deliberately does NOT do: re-encode images. Node has no
// built-in image codec and Phase 2 adds no dependencies, so pixel-level
// re-encoding is not possible here; instead uploads pass through a
// quarantine key + the pluggable AV-scan hook (see av-scan.ts) before
// promotion. The decision is recorded in docs/DECISIONS.md.

import { createHash } from "crypto";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type MediaFormat = "jpeg" | "png" | "webp" | "glb";

export const FORMAT_MIME: Record<MediaFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  glb: "model/gltf-binary",
};

export const FORMAT_EXT: Record<MediaFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  glb: "glb",
};

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identify a buffer purely from its leading bytes. */
export function sniffFormat(buffer: Buffer): MediaFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && PNG_SIGNATURE.every((b, i) => buffer[i] === b)) return "png";
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  )
    return "webp";
  if (buffer.length >= 4 && buffer.toString("latin1", 0, 4) === "glTF") return "glb";
  return null;
}

/** Structural GLB check: magic, version 2, and the header's declared total
 *  length must equal the actual buffer length (a truncated or padded file
 *  is not a GLB we will store). */
export function isValidGlb(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString("latin1", 0, 4) !== "glTF") return false;
  if (buffer.readUInt32LE(4) !== 2) return false;
  if (buffer.readUInt32LE(8) !== buffer.length) return false;
  return true;
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  // IHDR must be the first chunk, at offset 8 (length) + 4 (type).
  if (buffer.length < 24 || buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let pos = 2; // skip SOI
  while (pos + 4 <= buffer.length) {
    if (buffer[pos] !== 0xff) return null;
    const marker = buffer[pos + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(pos + 2);
    if (segmentLength < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (pos + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(pos + 5);
      const width = buffer.readUInt16BE(pos + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    pos += 2 + segmentLength;
  }
  return null;
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 21) return null;
  const chunk = buffer.toString("latin1", 12, 16);
  if (chunk === "VP8X") {
    if (buffer.length < 30) return null;
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }
  if (chunk === "VP8 ") {
    // Lossy: frame tag (3) + start code (3) then 14-bit dimensions.
    if (buffer.length < 30) return null;
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    // Lossless: signature byte, then two packed 14-bit dimensions.
    if (buffer.length < 25 || buffer[20] !== 0x2f) return null;
    const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
    const width = 1 + (b1 | ((b2 & 0x3f) << 8));
    const height = 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    return { width, height };
  }
  return null;
}

export function imageDimensions(
  buffer: Buffer,
  format: Exclude<MediaFormat, "glb">,
): { width: number; height: number } | null {
  if (format === "png") return pngDimensions(buffer);
  if (format === "jpeg") return jpegDimensions(buffer);
  return webpDimensions(buffer);
}

export type UploadValidation =
  | {
      ok: true;
      format: MediaFormat;
      mime: string;
      isModel: boolean;
      dimensions: { width: number; height: number } | null;
    }
  | { ok: false; error: string };

/** Full upload gate: size, magic bytes, and structural parse. */
export function validateUpload(buffer: Buffer): UploadValidation {
  if (buffer.length === 0) return { ok: false, error: "Choose a file to upload." };
  if (buffer.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Choose a file under 20 MB." };
  const format = sniffFormat(buffer);
  if (!format) return { ok: false, error: "Supported formats: JPG, PNG, WebP, and GLB." };
  if (format === "glb") {
    if (!isValidGlb(buffer)) return { ok: false, error: "This is not a valid GLB file." };
    return { ok: true, format, mime: FORMAT_MIME.glb, isModel: true, dimensions: null };
  }
  const dimensions = imageDimensions(buffer, format);
  if (!dimensions) return { ok: false, error: "This image file appears to be corrupt or truncated." };
  return { ok: true, format, mime: FORMAT_MIME[format], isModel: false, dimensions };
}
