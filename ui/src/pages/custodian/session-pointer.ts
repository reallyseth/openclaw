import { getSafeSessionStorage } from "../../local-storage.ts";
import type { CustodianSessionVariant } from "./session-lifecycle.ts";

const CUSTODIAN_SESSION_POINTER_PREFIX = "openclaw.custodian.live-session";

function pointerKey(gatewayUrl: string, variant: CustodianSessionVariant): string {
  return `${CUSTODIAN_SESSION_POINTER_PREFIX}:${encodeURIComponent(gatewayUrl)}:${variant}`;
}

export function readCustodianSessionPointer(
  gatewayUrl: string,
  variant: CustodianSessionVariant,
): string | null {
  const storage = getSafeSessionStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(pointerKey(gatewayUrl, variant));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return record.variant === variant && typeof record.sessionId === "string" && record.sessionId
      ? record.sessionId
      : null;
  } catch {
    return null;
  }
}

export function writeCustodianSessionPointer(
  gatewayUrl: string,
  variant: CustodianSessionVariant,
  sessionId: string,
): void {
  try {
    getSafeSessionStorage()?.setItem(
      pointerKey(gatewayUrl, variant),
      JSON.stringify({ sessionId, variant }),
    );
  } catch {
    // Storage can be disabled independently of the live Gateway session.
  }
}

export function clearCustodianSessionPointer(
  gatewayUrl: string,
  variant: CustodianSessionVariant,
): void {
  try {
    getSafeSessionStorage()?.removeItem(pointerKey(gatewayUrl, variant));
  } catch {
    // Best-effort cleanup only.
  }
}
