import type { Caption } from "../domain/caption.js";

export type CaptionListener = (caption: Caption) => void;

const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Publish/subscribe hub for captions, keyed by session id. Keeps a bounded
 * recent history per session so late subscribers (e.g. a viewer that just
 * connected) can catch up.
 */
export class CaptionBus {
  private readonly listeners = new Map<string, Set<CaptionListener>>();
  private readonly histories = new Map<string, Caption[]>();

  constructor(private readonly historyLimit: number = DEFAULT_HISTORY_LIMIT) {}

  publish(caption: Caption): void {
    const history = this.histories.get(caption.sessionId) ?? [];
    history.push(caption);
    if (history.length > this.historyLimit) {
      history.shift();
    }
    this.histories.set(caption.sessionId, history);

    for (const listener of this.listeners.get(caption.sessionId) ?? []) {
      listener(caption);
    }
  }

  subscribe(sessionId: string, listener: CaptionListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  history(sessionId: string): Caption[] {
    return [...(this.histories.get(sessionId) ?? [])];
  }
}
