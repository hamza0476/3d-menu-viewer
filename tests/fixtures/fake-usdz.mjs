// Test-only stand-in for an external USDZ converter (Phase 4 adapter
// proof). Writes a ZIP-shaped file (USDZ is an uncompressed ZIP) whose
// bytes derive from the input, so the suite can prove the conversion
// step ran and its output was stored as a model-usdz asset. It is NOT a
// real USDZ scene — the pipeline only guarantees "the configured
// converter produced a non-empty file"; scene correctness belongs to
// the real converter an operator installs.
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const [input, output] = process.argv.slice(2);
const src = readFileSync(input);
const digest = createHash("sha256").update(src).digest();
writeFileSync(output, Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), digest, src.subarray(0, 64)]));
