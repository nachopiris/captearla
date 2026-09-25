export interface SessionInfo {
  id: string;
  name: string;
  live: boolean;
  createdAt: number;
  lastActivity: number;
}

const MAX_NAME_LENGTH = 80;

function sanitizeName(name: string | undefined): string {
  return (name ?? "").trim().slice(0, MAX_NAME_LENGTH);
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

  /**
   * Looks up a session, creating it (not live) on first use. A blank or
   * missing `name` leaves the session's current name untouched (new
   * sessions default to their id); a non-empty `name` is trimmed, capped
   * at 80 characters, and renames the session (last non-empty name wins).
   */
  ensure(id: string, name?: string): SessionInfo {
    const sanitized = sanitizeName(name);
    let session = this.sessions.get(id);
    if (!session) {
      const timestamp = this.now();
      session = { id, name: sanitized || id, live: false, createdAt: timestamp, lastActivity: timestamp };
      this.sessions.set(id, session);
      return session;
    }
    if (sanitized) {
      session.name = sanitized;
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
