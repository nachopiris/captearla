export interface SessionInfo {
  id: string;
  name: string;
  live: boolean;
  createdAt: number;
  lastActivity: number;
}

/**
 * Tracks known conference sessions. Predefined sessions are pre-populated
 * (not live); new sessions are also auto-created on first ingest via
 * `ensure()`.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionInfo>();

  constructor(predefined: string[] = [], private readonly now: () => number = Date.now) {
    for (const id of predefined) {
      this.ensure(id);
    }
  }

  ensure(id: string, name: string = id): SessionInfo {
    let session = this.sessions.get(id);
    if (!session) {
      const timestamp = this.now();
      session = { id, name, live: false, createdAt: timestamp, lastActivity: timestamp };
      this.sessions.set(id, session);
    }
    return session;
  }

  markLive(id: string, live: boolean): void {
    const session = this.ensure(id);
    session.live = live;
    session.lastActivity = this.now();
  }

  get(id: string): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()];
  }
}
