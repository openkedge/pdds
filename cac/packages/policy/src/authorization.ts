import type { AuthorizationSnapshot } from "@cac/schemas";

export interface LiveAuthorizer {
  isAuthorizedLive(principal: string, action: string, scope: string[]): boolean;
  revoke(principal: string, action?: string): void;
  grant(principal: string, action: string, scope: string[]): void;
}

export class MemoryAuthorizer implements LiveAuthorizer, AuthorizationSnapshot {
  private allowed = new Map<string, Set<string>>();

  constructor(initialGrants: Array<{ principal: string; action: string; scope: string[] }> = []) {
    for (const grant of initialGrants) {
      this.grant(grant.principal, grant.action, grant.scope);
    }
  }

  private makeKey(principal: string, action: string, scopeItem: string): string {
    return `${principal}::${action}::${scopeItem}`;
  }

  grant(principal: string, action: string, scope: string[]): void {
    for (const s of scope) {
      const key = this.makeKey(principal, action, s);
      let set = this.allowed.get(principal);
      if (!set) {
        set = new Set();
        this.allowed.set(principal, set);
      }
      set.add(key);
    }
  }

  revoke(principal: string, action?: string): void {
    if (!action) {
      this.allowed.delete(principal);
    } else {
      const set = this.allowed.get(principal);
      if (set) {
        for (const item of Array.from(set)) {
          if (item.startsWith(`${principal}::${action}::`)) {
            set.delete(item);
          }
        }
      }
    }
  }

  isAuthorized(principal: string, action: string, scope: string[]): boolean {
    const set = this.allowed.get(principal);
    if (!set) return false;
    for (const s of scope) {
      if (!set.has(this.makeKey(principal, action, s))) {
        return false;
      }
    }
    return true;
  }

  isAuthorizedLive(principal: string, action: string, scope: string[]): boolean {
    return this.isAuthorized(principal, action, scope);
  }

  createSnapshot(): AuthorizationSnapshot {
    // Freezes current permissions into an immutable snapshot
    const copy = new Map<string, Set<string>>();
    for (const [k, v] of this.allowed.entries()) {
      copy.set(k, new Set(v));
    }
    return {
      isAuthorized: (principal: string, action: string, scope: string[]): boolean => {
        const set = copy.get(principal);
        if (!set) return false;
        for (const s of scope) {
          if (!set.has(`${principal}::${action}::${s}`)) {
            return false;
          }
        }
        return true;
      },
    };
  }
}
