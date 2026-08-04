/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import { createContext, mountPage } from "./custodian-page.test-harness.ts";
import { writeCustodianSessionPointer } from "./session-pointer.ts";

function createSessionStorage(): Storage {
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

describe("custodian session recovery", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    vi.stubGlobal("sessionStorage", createSessionStorage());
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("restores the exact live secret step after reload without restoring its draft", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "openclaw.chat.history") {
        return params.sessionId === "reload-session"
          ? {
              turns: [{ role: "assistant", text: "Enter the secret.", at: 1 }],
              session: {
                sessionId: "reload-session",
                step: {
                  id: "secret",
                  type: "text",
                  message: "Twitch client secret",
                  sensitive: true,
                },
              },
            }
          : { turns: [] };
      }
      if (params.wizardCancel) {
        return {
          sessionId: "reload-session",
          reply: "Twitch setup cancelled.",
          action: "none",
        };
      }
      return {
        sessionId: "reload-session",
        reply: "Enter the secret.",
        action: "none",
        sensitive: true,
        wizardInputPending: true,
        step: {
          id: "secret",
          type: "text",
          message: "Twitch client secret",
          sensitive: true,
        },
      };
    });
    const { context } = createContext(request, ["openclaw.chat", "openclaw.chat.history"]);
    const first = await mountPage(context);
    const firstInput = await waitForFast(() => {
      const input = first.page.querySelector<HTMLInputElement>(".custodian__wizard-step input");
      expect(input).not.toBeNull();
      return input!;
    });
    firstInput.value = "must-not-survive-reload";
    firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    first.page
      .querySelector<HTMLButtonElement>(
        '.custodian__wizard-step button[aria-label="Reveal value"]',
      )!
      .click();
    await first.page.updateComplete;
    first.provider.remove();

    const second = await mountPage(context);
    const restoredInput = await waitForFast(() => {
      const input = second.page.querySelector<HTMLInputElement>(".custodian__wizard-step input");
      expect(input).not.toBeNull();
      return input!;
    });
    expect(restoredInput.type).toBe("password");
    expect(restoredInput.value).toBe("");
    expect(second.page.textContent).not.toContain("must-not-survive-reload");
    expect(request.mock.calls.filter(([method]) => method === "openclaw.chat")).toHaveLength(1);
    expect(request.mock.calls).toContainEqual([
      "openclaw.chat.history",
      { sessionId: "reload-session" },
      expect.any(Object),
    ]);

    second.page.querySelector<HTMLButtonElement>(".custodian__wizard-cancel")!.click();
    await waitForFast(() =>
      expect(request.mock.calls.filter(([method]) => method === "openclaw.chat")).toHaveLength(2),
    );
    expect(request.mock.calls.at(-1)?.[1]).toEqual({
      sessionId: "reload-session",
      wizardCancel: { stepId: "secret" },
    });
  });

  it("keeps a restored control separate from another session's transcript tail", async () => {
    writeCustodianSessionPointer("ws://gateway.test/control", "onboarding", "interleaved-session");
    const request = vi.fn().mockResolvedValue({
      turns: [{ role: "assistant", text: "Another session finished setup.", at: 1 }],
      session: {
        sessionId: "interleaved-session",
        step: {
          id: "secret",
          type: "text",
          message: "Twitch client secret",
          sensitive: true,
        },
      },
    });
    const { context } = createContext(request, ["openclaw.chat", "openclaw.chat.history"]);
    const { page } = await mountPage(context);

    await waitForFast(() =>
      expect(page.querySelector<HTMLInputElement>(".custodian__wizard-step input")).not.toBeNull(),
    );
    expect(page.store.messages).toMatchObject([
      { text: "Another session finished setup.", step: null },
      { text: "", step: { id: "secret" } },
    ]);
  });

  it("keeps a stored live session retryable when history is temporarily unavailable", async () => {
    writeCustodianSessionPointer(
      "ws://gateway.test/control",
      "onboarding",
      "retryable-reload-session",
    );
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("history request timed out"))
      .mockResolvedValueOnce({
        turns: [{ role: "assistant", text: "Enter the secret.", at: 1 }],
        session: {
          sessionId: "retryable-reload-session",
          step: {
            id: "secret",
            type: "text",
            message: "Twitch client secret",
            sensitive: true,
          },
        },
      });
    const { context } = createContext(request, ["openclaw.chat", "openclaw.chat.history"]);
    const { page } = await mountPage(context);

    const retry = await waitForFast(() => {
      const button = page.querySelector<HTMLButtonElement>('[role="alert"] button');
      expect(button?.textContent).toContain("Retry");
      return button!;
    });
    expect(request.mock.calls.filter(([method]) => method === "openclaw.chat")).toHaveLength(0);

    retry.click();
    await waitForFast(() =>
      expect(page.querySelector<HTMLInputElement>(".custodian__wizard-step input")).not.toBeNull(),
    );
    expect(request.mock.calls).toEqual([
      ["openclaw.chat.history", { sessionId: "retryable-reload-session" }, expect.any(Object)],
      ["openclaw.chat.history", { sessionId: "retryable-reload-session" }, expect.any(Object)],
    ]);
  });

  it("retries a pending restore after the same owner reconnects", async () => {
    writeCustodianSessionPointer(
      "ws://gateway.test/control",
      "onboarding",
      "reconnect-reload-session",
    );
    const initialRequest = vi.fn().mockRejectedValue(new Error("history request timed out"));
    const { context, setGatewaySnapshot } = createContext(initialRequest, [
      "openclaw.chat",
      "openclaw.chat.history",
    ]);
    const { page } = await mountPage(context);
    await waitForFast(() =>
      expect(page.querySelector<HTMLButtonElement>('[role="alert"] button')).not.toBeNull(),
    );

    const replacementRequest = vi.fn().mockResolvedValue({
      turns: [{ role: "assistant", text: "Enter the secret.", at: 1 }],
      session: {
        sessionId: "reconnect-reload-session",
        step: {
          id: "secret",
          type: "text",
          message: "Twitch client secret",
          sensitive: true,
        },
      },
    });
    setGatewaySnapshot({
      client: { request: replacementRequest } as unknown as GatewayBrowserClient,
    });

    await waitForFast(() =>
      expect(page.querySelector<HTMLInputElement>(".custodian__wizard-step input")).not.toBeNull(),
    );
    expect(replacementRequest.mock.calls).toEqual([
      ["openclaw.chat.history", { sessionId: "reconnect-reload-session" }, expect.any(Object)],
    ]);
    expect(
      replacementRequest.mock.calls.filter(([method]) => method === "openclaw.chat"),
    ).toHaveLength(0);
  });

  it("cold-starts when the gateway no longer owns the stored live session", async () => {
    writeCustodianSessionPointer(
      "ws://gateway.test/control",
      "onboarding",
      "gateway-restarted-session",
    );
    const request = vi.fn(async (method: string, params: Record<string, unknown>) =>
      method === "openclaw.chat.history"
        ? { turns: [] }
        : { sessionId: params.sessionId, reply: "Fresh welcome.", action: "none" },
    );
    const { context } = createContext(request, ["openclaw.chat", "openclaw.chat.history"]);
    await mountPage(context);

    await waitForFast(() =>
      expect(request.mock.calls.filter(([method]) => method === "openclaw.chat")).toHaveLength(1),
    );
    expect(request.mock.calls[0]?.[1]).toEqual({ sessionId: "gateway-restarted-session" });
    const freshParams = request.mock.calls.find(([method]) => method === "openclaw.chat")?.[1];
    expect(freshParams?.sessionId).not.toBe("gateway-restarted-session");
  });
});
