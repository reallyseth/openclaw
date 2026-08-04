import { resolveSystemAgentDelegationKey } from "../../system-agent/delegation-session.js";
import { acknowledgeSystemAgentGreetingDelivery } from "../../system-agent/greeting.js";
import type { GatewayClient, GatewayRequestContext } from "./types.js";

type SystemAgentChatSession =
  GatewayRequestContext["systemAgentSessions"] extends Map<string, infer Session> ? Session : never;

export function resolveSystemAgentSessionOwnerKey(params: {
  delegation?: { agentId?: string; sessionKey?: string };
  client: GatewayClient | null;
}): string | undefined {
  const delegationKey = resolveSystemAgentDelegationKey(params.delegation);
  if (delegationKey !== undefined) {
    // Delegation is the host-only, cross-connection owner asserted by the regular-agent
    // tool path. Keep its agent/session tuple authoritative across gateway reconnects.
    return delegationKey;
  }
  // Authenticated users survive reconnects and may span paired devices. Otherwise
  // bind to the verified device, with the server-issued connection as a last resort.
  const userId = params.client?.authenticatedUserId?.trim();
  if (userId) {
    return `user:${userId}`;
  }
  const deviceId = params.client?.connect.device?.id.trim();
  if (deviceId) {
    return `device:${deviceId}`;
  }
  const connId = params.client?.connId?.trim();
  return connId ? `connection:${connId}` : undefined;
}

export function acknowledgeDeliveredSystemAgentWelcome(session: SystemAgentChatSession): void {
  const auditSequence = session.welcomeAuditSequence;
  if (auditSequence === undefined) {
    return;
  }
  acknowledgeSystemAgentGreetingDelivery({ auditSequence });
  delete session.welcomeAuditSequence;
}

export function resolveSystemAgentHistorySession(params: {
  requestedSessionId?: string;
  sessions: Map<string, SystemAgentChatSession>;
  client: GatewayClient | null;
}) {
  const { requestedSessionId } = params;
  if (!requestedSessionId) {
    return undefined;
  }
  const liveSession = params.sessions.get(requestedSessionId);
  const ownerKey = resolveSystemAgentSessionOwnerKey({ client: params.client });
  if (!liveSession || !ownerKey || liveSession.ownerKey !== ownerKey) {
    return undefined;
  }
  const activeStep = liveSession.engine.getActiveWizardStep();
  return {
    sessionId: requestedSessionId,
    ...(activeStep ? { step: activeStep } : {}),
  };
}
