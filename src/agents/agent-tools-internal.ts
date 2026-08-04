import { createOpenClawCodingToolsInternal } from "./agent-tools.js";

type OpenClawCodingToolsInternalOptions = NonNullable<
  Parameters<typeof createOpenClawCodingToolsInternal>[0]
>;

export function createOpenClawCodingToolsForRuntime(
  options?: OpenClawCodingToolsInternalOptions,
): ReturnType<typeof createOpenClawCodingToolsInternal> {
  return createOpenClawCodingToolsInternal(options);
}
