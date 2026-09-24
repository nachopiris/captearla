import { describe, expect, it } from "vitest";
import { pcmToWav } from "../../../src/captions/infrastructure/pcm-to-wav.js";

describe("pcmToWav", () => {
  it("produces a valid canonical WAV header for mono 16-bit PCM", () => {
    const pcm = new Int16Array([0, 100, -100, 32767, -32768]);
    const wav = pcmToWav(pcm, 16000);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk size (PCM)
    expect(wav.readUInt16LE(20)).toBe(1); // audio format: PCM
    expect(wav.readUInt16LE(22)).toBe(1); // channels: mono
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.toString("ascii", 36, 40)).toBe("data");
  });

  it("declares a data chunk size and total file size matching the PCM payload", () => {
    const pcm = new Int16Array(100);
    const wav = pcmToWav(pcm, 16000);

    const expectedDataBytes = pcm.length * 2;
    expect(wav.readUInt32LE(40)).toBe(expectedDataBytes);
    expect(wav.readUInt32LE(4)).toBe(36 + expectedDataBytes);
    expect(wav.length).toBe(44 + expectedDataBytes);
  });

  it("preserves the exact PCM sample values in the data section", () => {
    const pcm = new Int16Array([1234, -1234, 0, 32767, -32768]);
    const wav = pcmToWav(pcm, 16000);

    for (let i = 0; i < pcm.length; i++) {
      expect(wav.readInt16LE(44 + i * 2)).toBe(pcm[i]);
    }
  });

  it("accepts a Buffer of PCM16LE bytes as well as an Int16Array", () => {
    const int16 = new Int16Array([42, -42]);
    const buffer = Buffer.from(int16.buffer);
    const wav = pcmToWav(buffer, 16000);

    expect(wav.readInt16LE(44)).toBe(42);
    expect(wav.readInt16LE(46)).toBe(-42);
  });
});
