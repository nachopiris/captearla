export interface WavInfo {
  pcm: Int16Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/**
 * Parses a WAV file buffer and extracts its PCM16 samples along with the
 * format fields needed to validate it (sample rate, channel count). Walks
 * chunks generically so it tolerates extra chunks (e.g. LIST) between "fmt "
 * and "data", which real-world WAV files commonly have.
 */
export function parseWavPcm16(buffer: Buffer): WavInfo {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a valid WAV file: missing RIFF/WAVE header");
  }

  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: { start: number; length: number } | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      fmt = {
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    } else if (chunkId === "data") {
      data = { start: chunkStart, length: chunkSize };
    }

    // Chunks are padded to an even number of bytes.
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    throw new Error("Not a valid WAV file: missing fmt chunk");
  }
  if (!data) {
    throw new Error("Not a valid WAV file: missing data chunk");
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV bit depth: ${fmt.bitsPerSample} (expected 16-bit PCM)`);
  }

  const sampleCount = Math.floor(data.length / 2);
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = buffer.readInt16LE(data.start + i * 2);
  }

  return { pcm, sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample };
}
