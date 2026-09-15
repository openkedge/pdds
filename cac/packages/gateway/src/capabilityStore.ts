import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { access, open } from "node:fs/promises";
import { join } from "node:path";

export interface CapabilityStore {
  isUnused(nonce: string): Promise<boolean>;
  consumeOnce(nonce: string): Promise<boolean>;
  reset(): Promise<void>;
}

/**
 * In-memory linearizable atomic CAS capability store.
 * Transitions nonces UNUSED -> CONSUMED with a single winner.
 * Conforms to Section 4.4 and Section 23 of the CAC requirements.
 */
export class MemoryCapabilityStore implements CapabilityStore {
  private nonces = new Map<string, "UNUSED" | "CONSUMED">();
  private locks = new Map<string, Promise<void>>();

  private async acquireLock(nonce: string): Promise<() => void> {
    while (this.locks.has(nonce)) {
      await this.locks.get(nonce);
    }
    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(nonce, lockPromise);

    return () => {
      this.locks.delete(nonce);
      resolveLock();
    };
  }

  async registerNonce(nonce: string): Promise<void> {
    if (!this.nonces.has(nonce)) {
      this.nonces.set(nonce, "UNUSED");
    }
  }

  async isUnused(nonce: string): Promise<boolean> {
    const status = this.nonces.get(nonce);
    // If not registered yet, default to UNUSED
    return status === undefined || status === "UNUSED";
  }

  async consumeOnce(nonce: string): Promise<boolean> {
    const release = await this.acquireLock(nonce);
    try {
      const current = this.nonces.get(nonce);
      if (current === "CONSUMED") {
        return false;
      }
      // Atomic transition UNUSED -> CONSUMED
      this.nonces.set(nonce, "CONSUMED");
      return true;
    } finally {
      release();
    }
  }

  async reset(): Promise<void> {
    this.nonces.clear();
    this.locks.clear();
  }
}

/** Persistent single-host replay protection. Requires a local filesystem with atomic
 * exclusive creation and fsync; shared network filesystems are not supported. A
 * successful consume is flushed before dispatch. Errors leave the nonce burned. */
export class FileCapabilityStore implements CapabilityStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  private path(nonce: string): string {
    return join(this.directory, createHash("sha256").update(nonce).digest("hex") + ".spent");
  }
  async isUnused(nonce: string): Promise<boolean> {
    try { await access(this.path(nonce)); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
  }
  async consumeOnce(nonce: string): Promise<boolean> {
    let handle;
    try { handle = await open(this.path(nonce), "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    try { await handle.sync(); } finally { await handle.close(); }
    const directory = await open(this.directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return true;
  }
  async reset(): Promise<void> { throw new Error("Persistent nonces cannot be reset while certificates may remain valid"); }
}
