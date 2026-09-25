import { describe, expect, it } from "vitest";
import { parseWavPcm16 } from "../../../src/captions/infrastructure/wav-to-pcm.js";
import { pcmToWav } from "../../../src/captions/infrastructure/pcm-to-wav.js";

describe("parseWavPcm16", () => {
  it("round-trips PCM samples encoded by pcmToWav", () => {
    const original = new Int16Array([0, 100, -100, 32767, -32768, 42]);
    const wav = pcmToWav(original, 16000);

    const parsed = parseWavPcm16(wav);

    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(Array.from(parsed.pcm)).toEqual(Array.from(original));
  });

  it("rejects a buffer that is not a RIFF/WAVE file", () => {
    const bogus = Buffer.from("not a wav file at all, just text");
    expect(() => parseWavPcm16(bogus)).toThrow(/RIFF|WAVE/i);
  });

  it("rejects a WAV file with a bit depth other than 16", () => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(32, 34); // 32-bit samples
    header.write("data", 36, "ascii");
    header.writeUInt32LE(0, 40);

    expect(() => parseWavPcm16(header)).toThrow(/16/);
  });
});
