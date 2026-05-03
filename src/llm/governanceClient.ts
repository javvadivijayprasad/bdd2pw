/**
 * Routes every LLM call through the `ai-governance` sidecar (default :8004).
 * No direct calls to provider SDKs — providers are plugins inside the sidecar.
 *
 * Phase 4 work item.
 */

export class GovernanceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GovernanceError";
  }
}

export interface GovernanceCallInput {
  provider: "anthropic" | "openai" | "gemini";
  model?: string;
  prompt: string;
  context?: Record<string, unknown>;
  governanceUrl?: string;
}

export interface GovernanceCallResult {
  text: string;
  redactions: number;
  provider: string;
  model: string;
}

export async function callViaGovernance(
  _input: GovernanceCallInput,
): Promise<GovernanceCallResult> {
  throw new GovernanceError("callViaGovernance() — Phase 4");
}
