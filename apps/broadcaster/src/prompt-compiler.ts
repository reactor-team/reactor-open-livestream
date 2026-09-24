export type Voice = { name: string; voice: string };
export type SceneParts = { visual: string; speaker: string; dialogue: string; sound: string };

export const SCENE_LIMITS = { prompt: 800, visual: 650, sound: 80, speaker: 32, dialogue: 140, voice: 64 } as const;

const sentence = (text: string) => /[.!?]$/.test(text) ? text : `${text}.`;
const speechText = (speaker: string, voice: string, dialogue: string) => `${speaker} says (${voice.replace(/[.!?]+$/, "")}): "${sentence(dialogue)}"`;

// Reserve the longest possible complete speech and sound before generation, including punctuation and separators.
export function sceneVisualBudget(geometry: string, cast?: Voice[]): number {
  const possibleCast = cast ?? [{ name: "n".repeat(SCENE_LIMITS.speaker), voice: "v".repeat(SCENE_LIMITS.voice) }];
  const speechLength = Math.max("No speech.".length, ...possibleCast.map(voice =>
    speechText(voice.name, voice.voice, "d".repeat(SCENE_LIMITS.dialogue)).length));
  const fixed = [geometry, "s".repeat(speechLength), `Sound: ${sentence("s".repeat(SCENE_LIMITS.sound))}`].filter(Boolean).join(" ");
  const budget = Math.min(SCENE_LIMITS.visual, SCENE_LIMITS.prompt - fixed.length - 2);
  if (budget < 1) throw new Error("Application geometry leaves no room for a scene");
  return budget;
}

function field(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  const text = value.replace(/[\u2014\u2013]/g, "-").replace(/\s+/g, " ").trim();
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters (${text.length})`);
  if (/["“”<>]/.test(text)) throw new Error(`${name} must not contain quotes or markup`);
  return text;
}

export function validateCast(value: unknown): Voice[] {
  if (!Array.isArray(value) || value.length > 4) throw new Error("cast must contain at most 4 speakers");
  const cast = value.map(item => {
    if (!item || typeof item !== "object") throw new Error("Invalid cast member");
    const name = field(item.name, "speaker name", SCENE_LIMITS.speaker);
    const voice = field(item.voice, "voice", SCENE_LIMITS.voice);
    if (!name || !voice) throw new Error("Cast names and voices must not be empty");
    if (/literally|sounds? like|voice of|use .+voice/i.test(voice)) throw new Error("Voice must describe acoustic qualities, not an identity reference");
    if (!/baritone|tenor|alto|bass|soprano|contralto|register|pitch|timbre|resonan|nasal|breath|rasp|gravel|husky|mid-range|low|high|deep|soft|warm|bright|clear|diction|cadence/i.test(voice)) {
      throw new Error("Voice needs acoustic traits such as register, timbre and cadence, not a person's name");
    }
    return { name, voice };
  });
  if (new Set(cast.map(item => item.name.toLowerCase())).size !== cast.length) throw new Error("Duplicate cast names");
  return cast;
}

export function compileScene(raw: SceneParts, cast: Voice[], geometry: string, maxWords: number) {
  const visual = field(raw.visual, "visual", SCENE_LIMITS.visual);
  const sound = field(raw.sound, "sound", SCENE_LIMITS.sound);
  const speaker = field(raw.speaker, "speaker", SCENE_LIMITS.speaker);
  const dialogue = field(raw.dialogue, "dialogue", SCENE_LIMITS.dialogue);
  if (!visual) throw new Error("visual must contain an action");
  if (geometry && /\d+(?:\.\d+)?\s*(?:m\b|met[er]|cm\b|centimet|feet\b|foot\b|inches\b|%)/i.test(visual)) {
    throw new Error("Geometry is already supplied by the application; remove all measurements from visual and describe only the reaction");
  }
  if (Boolean(speaker) !== Boolean(dialogue)) throw new Error("speaker and dialogue must both be set or both empty");
  if (dialogue && dialogue.split(/\s+/).length > maxWords) throw new Error(`dialogue exceeds ${maxWords} words for this duration`);
  const voice = cast.find(item => item.name === speaker);
  if (speaker && !voice) throw new Error("speaker must match the fixed cast exactly");
  const spokenDialogue = dialogue ? sentence(dialogue) : "";
  const speech = voice ? speechText(speaker, voice.voice, dialogue) : "No speech.";
  const videoPrompt = [geometry, sentence(visual), speech, sound ? `Sound: ${sentence(sound)}` : ""].filter(Boolean).join(" ");
  if (videoPrompt.length > SCENE_LIMITS.prompt) throw new Error(`Assembled prompt is ${videoPrompt.length} characters; shorten visual by at least ${videoPrompt.length - SCENE_LIMITS.prompt}, keeping dialogue complete`);
  // A record of the instructions actually accepted, not an invented account of rendered events.
  return { videoPrompt, dialogue: spokenDialogue, sceneSummary: [geometry, visual].filter(Boolean).join(" ") };
}
