// Test-only stand-in for an external GLB optimiser (Phase 4 adapter
// proof). It is a REAL external process boundary: the pipeline writes
// the source to a temp file, runs this command with {in}/{out}, and
// validates the output as a GLB before storing it. This fixture performs
// a small but genuine transformation — it rewrites the JSON chunk
// (stamps asset.generator and adds an extras marker) and rebuilds the
// container — so the suite can prove the adapter ran by the changed
// bytes, not by trusting a flag.
import { readFileSync, writeFileSync } from "fs";

const [input, output] = process.argv.slice(2);
const buf = readFileSync(input);
const jsonLength = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength).replace(/[\u0000\s]+$/, ""));
json.asset = { ...(json.asset || {}), generator: "fake-optimizer 1.0", extras: { optimized: true } };
const rest = buf.subarray(20 + jsonLength); // BIN chunk, untouched

function chunk(type, data, padByte) {
  const pad = (4 - (data.length % 4)) % 4;
  const out = Buffer.alloc(8 + data.length + pad, padByte);
  out.writeUInt32LE(data.length + pad, 0);
  out.writeUInt32LE(type, 4);
  data.copy(out, 8);
  return out;
}
const body = Buffer.concat([chunk(0x4e4f534a, Buffer.from(JSON.stringify(json)), 0x20), rest]);
const head = Buffer.alloc(12);
head.write("glTF", 0, "latin1");
head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + body.length, 8);
writeFileSync(output, Buffer.concat([head, body]));
