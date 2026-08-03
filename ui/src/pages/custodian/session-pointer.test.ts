import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCustodianSessionPointer,
  readCustodianSessionPointer,
  writeCustodianSessionPointer,
} from "./session-pointer.ts";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("Custodian live-session pointer", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores only the opaque session id and variant in gateway-scoped session storage", () => {
    writeCustodianSessionPointer("ws://gateway-a/control", "onboarding", "live-session");

    expect(readCustodianSessionPointer("ws://gateway-a/control", "onboarding")).toBe(
      "live-session",
    );
    expect(readCustodianSessionPointer("ws://gateway-b/control", "onboarding")).toBeNull();
    expect(readCustodianSessionPointer("ws://gateway-a/control", "caretaker")).toBeNull();
    const key = sessionStorage.key(0);
    expect(key).not.toBeNull();
    expect(sessionStorage.getItem(key!)).toBe(
      JSON.stringify({ sessionId: "live-session", variant: "onboarding" }),
    );
  });

  it("clears stale pointers and tolerates unavailable storage", () => {
    writeCustodianSessionPointer("ws://gateway-a/control", "caretaker", "stale-session");
    clearCustodianSessionPointer("ws://gateway-a/control", "caretaker");
    expect(readCustodianSessionPointer("ws://gateway-a/control", "caretaker")).toBeNull();

    vi.stubGlobal("sessionStorage", null);
    expect(readCustodianSessionPointer("ws://gateway-a/control", "caretaker")).toBeNull();
  });
});
