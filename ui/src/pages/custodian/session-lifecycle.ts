import {
  readSystemAgentSessionInvalidatedErrorDetails,
  type SystemAgentChatParams,
} from "@openclaw/gateway-protocol";
import { inferBasePathFromPathname, routeIdFromPath } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { normalizeAgentId } from "../../lib/sessions/session-key.ts";

export type CustodianSessionVariant = "onboarding" | "new-agent" | "caretaker";
export type ConfiguredInferenceState = "unresolved" | "required" | "ready";

export function hasCustodianUserInput(params: SystemAgentChatParams): boolean {
  return (
    params.message !== undefined ||
    params.wizardAnswer !== undefined ||
    params.wizardCancel !== undefined
  );
}

export function resolveConfiguredInferenceState(
  context: ApplicationContext | null,
): ConfiguredInferenceState {
  if (!context || context.gateway.snapshot.phase !== "connected") {
    return "unresolved";
  }
  const agentsList = context.agents.state.agentsList;
  if (!agentsList) {
    return "unresolved";
  }
  const selectedId = normalizeAgentId(
    context.gateway.snapshot.assistantAgentId ?? agentsList.defaultId ?? "",
  );
  const selectedAgent = agentsList.agents.find(
    (agent) => normalizeAgentId(agent.id) === selectedId,
  );
  if (!selectedAgent) {
    return "unresolved";
  }
  return selectedAgent.model?.primary?.trim() ? "ready" : "required";
}

export function sessionVariant(
  onboarding: boolean,
  newAgentIntent: boolean,
): CustodianSessionVariant {
  return onboarding ? "onboarding" : newAgentIntent ? "new-agent" : "caretaker";
}

export function custodianChatParams(
  variant: CustodianSessionVariant,
  message?: string,
): Pick<SystemAgentChatParams, "welcomeVariant" | "message" | "context"> {
  const variantParams = variant === "caretaker" ? {} : { welcomeVariant: variant };
  if (message === undefined) {
    return variantParams;
  }
  const pathname = window.location.pathname;
  const page = routeIdFromPath(pathname, inferBasePathFromPathname(pathname));
  return { ...variantParams, message, ...(page ? { context: { page } } : {}) };
}

export function isCustodianSessionInvalidatedError(error: unknown): boolean {
  const details =
    error && typeof error === "object" ? (error as { details?: unknown }).details : undefined;
  return readSystemAgentSessionInvalidatedErrorDetails(details) !== undefined;
}
