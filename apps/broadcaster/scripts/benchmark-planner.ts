/** Explicit opt-in text-only Cerebras benchmark. Never connects to Reactor or writes broadcast state. */
import { PEACE_TALKS } from "@reactor/infinite-contracts";
import { CerebrasStoryPlanner, type SceneDirection, type StoryHistoryItem } from "../src/story-planner";

if (!process.env.CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY is required");
const fixtures: { name: string; direction: SceneDirection }[] = [
  { name: "morgan", direction: { id: null, author: "Benchmark", text: "Morgan notices a tiny raincloud over his mixing bowl. One dry remark, restrained movement." } },
  { name: "table", direction: {
    id: null, author: "Benchmark", text: "The diplomats notice their table extending. One speaks a short line; the other stays silent.",
    continuityNotes: PEACE_TALKS.continuityNotes, voicePrompt: PEACE_TALKS.voicePrompt,
    table: { runId: "benchmark", lengthCm: 290, revision: 1 },
  } },
  { name: "legacy-voice", direction: {
    id: null, author: "Benchmark", text: "A game-show host holds a red button. He hesitates, then says one short line. Do not press it yet.",
    continuityNotes: "One host in a blue jacket, arena lighting, fixed medium shot. The button stays unpressed.",
    voicePrompt: "It's literally MrBeast's voice.",
  } },
];
const variants = process.argv.slice(2);
for (const variant of variants.length ? variants : ["gpt-oss-120b:low", "gpt-oss-120b:medium", "qwen-3.8-27b:low", "gemma-4-31b:low"]) {
  const [model, effort] = variant.split(":");
  if (!model || !["low", "medium", "high"].includes(effort || "")) throw new Error("Use model:low|medium|high");
  const planner = new CerebrasStoryPlanner({ apiKey: process.env.CEREBRAS_API_KEY, model, reasoningEffort: effort as "low" | "medium" | "high", timeoutMs: 5000, clipSeconds: 10 });
  for (const fixture of fixtures) {
    const history: StoryHistoryItem[] = [];
    for (let chunk = 0; chunk < 2; chunk++) {
      const start = Date.now();
      try {
        const plan = await planner.plan({ ...fixture.direction, text: chunk ? "Continue the visible action with one restrained reaction. Do not repeat the previous line." : fixture.direction.text }, history);
        history.push(plan);
        console.log(JSON.stringify({ variant, fixture: fixture.name, chunk, ms: plan.plannerLatencyMs, chars: plan.videoPrompt.length, prompt: plan.videoPrompt }));
      } catch (error) {
        console.log(JSON.stringify({ variant, fixture: fixture.name, chunk, ms: Date.now() - start, error: error instanceof Error ? error.message : "Failed" }));
      }
    }
  }
}
