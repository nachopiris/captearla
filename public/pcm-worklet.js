// AudioWorkletProcessor that downsamples the microphone's Float32 audio
// (at the browser's native sample rate) to 16 kHz mono PCM16, and posts it
// to the main thread in ~100ms frames ready to send over WebSocket.
//
// This uses simple linear interpolation for resampling. It has no
// anti-aliasing filter, which is a fine tradeoff for a live-captioning
// prototype (speech content, not audio fidelity) but not for music.

const TARGET_SAMPLE_RATE = 16000;
const FRAME_MS = 100;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSamplesPerFrame = Math.round((TARGET_SAMPLE_RATE * FRAME_MS) / 1000);
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.inputBuffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    for (let i = 0; i < channel.length; i++) {
      this.inputBuffer.push(channel[i]);
    }

    const inputSamplesNeeded = Math.floor(this.targetSamplesPerFrame * this.ratio);

    while (this.inputBuffer.length >= inputSamplesNeeded) {
      const chunk = this.inputBuffer.splice(0, inputSamplesNeeded);
      const out = new Int16Array(this.targetSamplesPerFrame);

      for (let j = 0; j < this.targetSamplesPerFrame; j++) {
        const srcIndex = j * this.ratio;
        const idx0 = Math.floor(srcIndex);
        const idx1 = Math.min(idx0 + 1, chunk.length - 1);
        const frac = srcIndex - idx0;
        const sample = chunk[idx0] * (1 - frac) + chunk[idx1] * frac;
        const clamped = Math.max(-1, Math.min(1, sample));
        out[j] = Math.round(clamped * 32767);
      }

      this.port.postMessage(out.buffer, [out.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
