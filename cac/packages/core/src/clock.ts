import type { Clock, Instant } from "@cac/schemas";
import { makeInstant } from "@cac/schemas";

export class SystemClock implements Clock {
  now(): Instant {
    return makeInstant(Date.now());
  }
}

export class FrozenClock implements Clock {
  private readonly instant: Instant;

  constructor(epochMsOrInstant: number | Instant) {
    if (typeof epochMsOrInstant === "number") {
      this.instant = makeInstant(epochMsOrInstant);
    } else {
      this.instant = epochMsOrInstant;
    }
  }

  now(): Instant {
    return this.instant;
  }
}

export class SteppableClock implements Clock {
  private currentEpochMs: number;

  constructor(initialEpochMs: number = Date.now()) {
    this.currentEpochMs = initialEpochMs;
  }

  now(): Instant {
    return makeInstant(this.currentEpochMs);
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("Cannot step clock backwards");
    }
    this.currentEpochMs += ms;
  }

  set(epochMs: number): void {
    this.currentEpochMs = epochMs;
  }
}
