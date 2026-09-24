const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

function toBuffer(pcm: Int16Array | Buffer): Buffer {
  if (Buffer.isBuffer(pcm)) {
    return pcm;
  }
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

/**
 * Wraps raw PCM16LE mono samples into a canonical 44-byte-header WAV file,
 * ready to send to a model that accepts `audio/wav` inline data.
 */
export function pcmToWav(pcm: Int16Array | Buffer, sampleRate: number): Buffer {
  const data = toBuffer(pcm);
  const byteRate = sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size for PCM
  header.writeUInt16LE(1, 20); // audio format: 1 = PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}
