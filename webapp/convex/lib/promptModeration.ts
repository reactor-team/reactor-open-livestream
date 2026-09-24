import { BASE_PROMPT_RULES, promptModerationPolicy, validatePromptCriteria } from "./promptModerationPolicy";
import { hasUnsafePromptEncoding, PROMPT_ENCODING_REASON } from "@reactor/infinite-contracts";
export { PROMPT_MODERATION_POLICY } from "./promptModerationPolicy";

type BaseCategory = typeof BASE_PROMPT_RULES[number]["category"];
export const MODERATION_REASONS = Object.fromEntries(BASE_PROMPT_RULES.map(rule => [rule.category, rule.reason])) as Record<BaseCategory, string>;

export type ModerationResult =
  | { status: "allowed" }
  | { status: "rejected"; category: BaseCategory | "additional"; reason: string }
  | { status: "unavailable"; reason: string };

export const MODERATION_UNAVAILABLE = "We couldn't check your prompt. It hasn't been shared or queued. Please try again.";
const unavailable = (): ModerationResult => ({ status: "unavailable", reason: MODERATION_UNAVAILABLE });

export async function moderatePrompt(
  input: { text: string; author: string; renderedScene?: string; additionalCriteria?: readonly string[] },
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<ModerationResult> {
  if (hasUnsafePromptEncoding(input.text) || hasUnsafePromptEncoding(input.author)
    || (input.renderedScene !== undefined && hasUnsafePromptEncoding(input.renderedScene))) {
    return { status: "rejected", category: "injection", reason: PROMPT_ENCODING_REASON };
  }
  if (input.renderedScene !== undefined && (!input.renderedScene.trim() || input.renderedScene.length > 800)) return unavailable();
  if (!apiKey?.trim() || apiKey.length > 512) return unavailable();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const criteria = validatePromptCriteria(input.additionalCriteria ?? []);
    const additional = Object.fromEntries(criteria.map((criterion, index) => [`additional_${index + 1}`, `Additional stream rule: ${criterion}`]));
    const categories = ["allowed", ...Object.keys(MODERATION_REASONS), ...Object.keys(additional)];
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey.trim() },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4.1-mini", temperature: 0, max_completion_tokens: 64, store: false,
        messages: [
          { role: "system", content: promptModerationPolicy(criteria) },
          { role: "user", content: JSON.stringify({ author: input.author, prompt: input.text,
            ...(input.renderedScene !== undefined ? { renderedScene: input.renderedScene } : {}) }) },
        ],
        response_format: { type: "json_schema", json_schema: {
          name: "prompt_moderation", strict: true,
          schema: { type: "object", properties: { category: { type: "string", enum: categories } },
            required: ["category"], additionalProperties: false },
        } },
      }),
    });
    if (!response.ok) return unavailable();
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (choice?.finish_reason !== "stop" || choice.message?.refusal || typeof choice.message?.content !== "string") return unavailable();
    const result: unknown = JSON.parse(choice.message.content);
    if (!result || typeof result !== "object" || Object.keys(result).length !== 1 || !("category" in result)) return unavailable();
    const category = result.category;
    if (category === "allowed") return { status: "allowed" };
    if (typeof category === "string" && Object.hasOwn(additional, category)) return { status: "rejected", category: "additional", reason: additional[category] };
    if (typeof category !== "string" || !Object.hasOwn(MODERATION_REASONS, category)) return unavailable();
    const code = category as keyof typeof MODERATION_REASONS;
    return { status: "rejected", category: code, reason: MODERATION_REASONS[code] };
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}
