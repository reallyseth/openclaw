import { beforeEach, describe, expect, it } from "vitest";
import {
  getAgentEventLifecycleGeneration,
  resetAgentEventsForTest,
  type AgentEventPayload,
} from "../infra/agent-events.js";
import { createAgentEventAuditRecorder } from "./agent-event-audit.js";
import type { AuditEventInput } from "./audit-event-types.js";
import type { AuditEventWriter } from "./audit-event-writer.js";

function agentEvent(overrides: Partial<AgentEventPayload>): AgentEventPayload {
  return {
    runId: "run-duplicate-start-order",
    seq: 1,
    stream: "lifecycle",
    ts: Date.now(),
    data: { phase: "start" },
    sessionKey: "agent:coder:main",
    sessionId: "session-1",
    agentId: "coder",
    ...overrides,
  };
}

function captureAuditWriter(inputs: AuditEventInput[]): AuditEventWriter {
  return {
    ready: Promise.resolve(),
    record: (input) => {
      inputs.push(input);
      return true;
    },
    stop: async () => {},
  };
}

beforeEach(() => {
  resetAgentEventsForTest();
});

describe("agent audit lifecycle generation ordering", () => {
  it("does not reorder open instances for a duplicate start", async () => {
    const inputs: AuditEventInput[] = [];
    const recorder = createAgentEventAuditRecorder({
      writer: captureAuditWriter(inputs),
      terminalSettleMs: 60_000,
    });
    const lifecycleGeneration = getAgentEventLifecycleGeneration();
    const generatedStart = agentEvent({
      lifecycleGeneration,
      sessionKey: "agent:generated:main",
      agentId: "generated",
    });

    recorder.record(generatedStart);
    recorder.record(
      agentEvent({
        lifecycleGeneration: undefined,
        seq: 2,
        sessionKey: "agent:legacy:main",
        agentId: "legacy",
      }),
    );
    recorder.record(generatedStart);
    recorder.record(
      agentEvent({
        lifecycleGeneration: undefined,
        seq: 3,
        sessionKey: undefined,
        sessionId: undefined,
        agentId: undefined,
        data: { phase: "end" },
      }),
    );
    await recorder.stop();

    expect(inputs.at(-1)).toMatchObject({
      action: "agent.run.finished",
      actorId: "legacy",
      agentId: "legacy",
    });
  });
});
