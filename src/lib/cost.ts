// Pricing per million tokens (as of early 2026)
// Cache write uses 1-hour pricing as conservative estimate (Claude Code typically uses 1h caching)
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  "claude-opus-4-5-20251101": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  "claude-opus-4-1-20250805": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 },
  "claude-opus-4-20250514": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
};

// Fallback for unknown models
const DEFAULT_PRICING = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 };

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-4-5-20251101": 200_000,
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-opus-4-1-20250805": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-sonnet-4-20250514": 200_000,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number
): number {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheReadTokens * pricing.cacheRead +
      cacheCreationTokens * pricing.cacheWrite) /
    1_000_000
  );
}
