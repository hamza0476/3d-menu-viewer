import { describe, it, expect } from "vitest";
import { sniffFormat, isValidGlb, imageDimensions, validateUpload, sha256Hex } from "@/lib/media-validation";

// --- Fixture builders: minimal-but-real file structures ---------------------

function pngFixture(width = 3, height = 5): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const chunk = Buffer.alloc(8 + 13 + 4);
  chunk.writeUInt32BE(13, 0);
  chunk.write("IHDR", 4, "latin1");
  ihdr.copy(chunk, 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk]);
}

function jpegFixture(width = 640, height = 480): Buffer {
  const app0 = Buffer.alloc(2 + 2 + 14);
  app0[0] = 0xff; app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF\0", 4, "latin1");
  const sof = Buffer.alloc(2 + 2 + 15);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function webpFixture(width = 17, height = 9): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "latin1");
  buf.write("VP8X", 12, "latin1");
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

export function glbFixture(json = '{"asset":{"version":"2.0"}}'): Buffer {
  const jsonBuf = Buffer.from(json, "utf8");
  const padded = Buffer.alloc(Math.ceil(jsonBuf.length / 4) * 4, 0x20);
  jsonBuf.copy(padded);
  const total = 12 + 8 + padded.length;
  const buf = Buffer.alloc(total);
  buf.write("glTF", 0, "latin1");
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(total, 8);
  buf.writeUInt32LE(padded.length, 12);
  buf.write("JSON", 16, "latin1");
  padded.copy(buf, 20);
  return buf;
}

// --- Tests -------------------------------------------------------------------

describe("sniffFormat (magic bytes, not client MIME)", () => {
  it("identifies jpeg/png/webp/glb from bytes", () => {
    expect(sniffFormat(pngFixture())).toBe("png");
    expect(sniffFormat(jpegFixture())).toBe("jpeg");
    expect(sniffFormat(webpFixture())).toBe("webp");
    expect(sniffFormat(glbFixture())).toBe("glb");
  });
  it("rejects HTML, SVG, GIF and plain text — the polyglot set", () => {
    expect(sniffFormat(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffFormat(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffFormat(Buffer.from("just some text"))).toBeNull();
    expect(sniffFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("imageDimensions", () => {
  it("reads PNG IHDR dimensions", () => {
    expect(imageDimensions(pngFixture(3, 5), "png")).toEqual({ width: 3, height: 5 });
  });
  it("reads JPEG SOF0 dimensions past other segments", () => {
    expect(imageDimensions(jpegFixture(640, 480), "jpeg")).toEqual({ width: 640, height: 480 });
  });
  it("reads WebP VP8X dimensions", () => {
    expect(imageDimensions(webpFixture(17, 9), "webp")).toEqual({ width: 17, height: 9 });
  });
  it("returns null for a truncated PNG signature with no IHDR", () => {
    expect(imageDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png")).toBeNull();
  });
});

describe("GLB structural validation", () => {
  it("accepts a well-formed GLB", () => {
    expect(isValidGlb(glbFixture())).toBe(true);
  });
  it("rejects a GLB whose declared length disagrees with the buffer", () => {
    const bad = Buffer.from(glbFixture());
    bad.writeUInt32LE(bad.length + 4, 8);
    expect(isValidGlb(bad)).toBe(false);
  });
  it("rejects version 1 and truncated headers", () => {
    const bad = Buffer.from(glbFixture());
    bad.writeUInt32LE(1, 4);
    expect(isValidGlb(bad)).toBe(false);
    expect(isValidGlb(Buffer.from("glTF"))).toBe(false);
  });
});

describe("validateUpload", () => {
  it("accepts each supported format and reports sniffed mime + dimensions", () => {
    const png = validateUpload(pngFixture(10, 20));
    expect(png).toMatchObject({ ok: true, format: "png", mime: "image/png", isModel: false, dimensions: { width: 10, height: 20 } });
    const glb = validateUpload(glbFixture());
    expect(glb).toMatchObject({ ok: true, format: "glb", mime: "model/gltf-binary", isModel: true });
  });
  it("rejects an HTML file even when the client would call it image/png", () => {
    const v = validateUpload(Buffer.from("<!doctype html><title>evil</title>"));
    expect(v.ok).toBe(false);
  });
  it("rejects an empty file and an oversized file", () => {
    expect(validateUpload(Buffer.alloc(0)).ok).toBe(false);
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    pngFixture().copy(big);
    expect(validateUpload(big).ok).toBe(false);
  });
  it("rejects a PNG-signature-only truncated upload as corrupt", () => {
    expect(validateUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).ok).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("matches the known sha256 of 'abc'", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
