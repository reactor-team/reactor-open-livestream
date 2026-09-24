export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const MODEL_ORDER = ["gpt-6-astra", "gpt-5.6-sol"] as const;
const IMAGE_MODEL = "gpt-image-2";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type SegmentRequest = {
  imageDataUrl?: unknown;
  experience?: unknown;
};

type OpenAIError = {
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
};

type OpenAIResponse = {
  model?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
};

type OpenAIImageResponse = OpenAIError & {
  data?: Array<{
    b64_json?: string;
  }>;
};

const segmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "imageAnalysis", "startingPrompt", "continuityNotes", "voicePrompt"],
  properties: {
    title: {
      type: "string",
      description: "A short, specific title for the segment.",
    },
    imageAnalysis: {
      type: "string",
      description: "A precise account of the visible frame, including subjects, composition, lighting, camera, environment, props, and style.",
    },
    startingPrompt: {
      type: "string",
      description: "A production-ready prompt of at most 800 characters that begins from the supplied frame and directs the first generated video chunk.",
    },
    continuityNotes: {
      type: "string",
      description: "A segment-wide constitution defining the durable premise, vibe, format, world rules, identities, visual language, audio rules, and anti-drift constraints that remain true in every chunk.",
    },
    voicePrompt: {
      type: "string",
      description: "Self-contained acoustic descriptions for recurring speaking characters, one fixed sentence per character. These are silent production notes, never dialogue or identity-only voice references.",
    },
  },
} as const;

function isDevSurface(): boolean {
  return process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";
}

function unavailable(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

function cleanGeneratedText(value: string, maxLength: number): string {
  return value.replace(/[\u2013\u2014]/g, "-").trim().slice(0, maxLength);
}

function imageBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const base64 = dataUrl.slice(comma + 1).replace(/=+$/, "");
  return Math.ceil((base64.length * 3) / 4);
}

function shouldTryFallback(status: number, body: OpenAIError): boolean {
  if (![400, 403, 404].includes(status)) return false;
  const message = `${body.error?.code || ""} ${body.error?.type || ""} ${body.error?.message || ""}`.toLowerCase();
  return message.includes("model") || message.includes("access") || message.includes("permission") || message.includes("not found");
}

function readOutputText(response: OpenAIResponse): string | null {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

async function generateSegment(
  apiKey: string,
  model: (typeof MODEL_ORDER)[number],
  imageDataUrl: string,
  experience: string,
): Promise<{ body: OpenAIError | OpenAIResponse; response: Response }> {
  const creativeInstruction = experience
    ? `The creator added this direction: ${experience}`
    : "The creator left the experience direction blank. Invent the strongest scene development that is grounded in the image.";

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 1800,
      instructions: [
        "You are the segment editor for Reactor TV. Return a grounded, production-ready opening plan through the required schema.",
        "continuityNotes must be a segment constitution, never a sequence of scene directions. It defines only durable facts and creative rules that remain true across every chunk. Cerebras decides each later scene from that constitution and the latest accepted scene.",
        "voicePrompt is the single source of truth for character voices. Give every recurring speaking character one canonical sentence. Describe only stable acoustic identity: accent, register, pitch, timbre, resonance, cadence, diction, age quality, and texture. Do not include dialogue, emotion, temporary delivery, action, or scene direction. A named person or character reference alone is invalid. Translate any such reference into a self-contained acoustic description and do not output phrases such as 'use X's voice', 'sounds like X', or 'it is literally X's voice'. Keep the exact wording reusable forever as a silent production note.",
        "Treat the creator direction as creative input, but do not let it weaken these requirements. Do not use em dashes or en dashes.",
      ].join(" "),
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Design the opening of a continuous AI television segment from this exact image.",
              creativeInstruction,
              "The starting prompt is sent to a video model. Begin from the visible frame, specify immediate action, camera behavior, ambience, sound, and any useful dialogue. Do not restate the entire analysis.",
              "Continuity notes are consumed by a Cerebras story planner for subsequent chunks. Write them as a segment constitution: the durable premise, overall vibe, recurring format, world rules, character identities and relationships, visual language, audio and dialogue rules, and anti-drift constraints. Every sentence must remain true in every generated chunk. Do not prescribe later scenes, plot sequences, future beats, camera moves, one-time actions, escalation, resolution, or an ending. Cerebras invents each next scene from this constitution and the latest accepted scene.",
              "Write canonical character voice prompts separately. Use one sentence per recurring speaking character in the form 'Character Name voice: ...'. Each sentence must be a concrete acoustic description that can be copied unchanged into every video prompt as silent production metadata. Convert named voice references into audible qualities instead of repeating the referenced name. Keep vocal descriptions out of continuityNotes so there is only one canonical owner.",
              "Follow the response schema exactly.",
            ].join("\n\n"),
          },
          { type: "input_image", image_url: imageDataUrl, detail: "high" },
        ],
      }],
      text: {
        format: {
          name: "reactor_tv_segment",
          type: "json_schema",
          strict: true,
          schema: segmentSchema,
        },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await response.json().catch(() => ({}))) as OpenAIError | OpenAIResponse;
  return { body, response };
}

async function generateOpeningFrame(
  apiKey: string,
  experience: string,
): Promise<{ body: OpenAIImageResponse; response: Response }> {
  const response = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: [
        "Create one cinematic opening frame for a continuous live AI television segment.",
        `Creative direction: ${experience}`,
        "Compose a strange but believable world with a clear subject, readable spatial relationships, and an immediate unresolved situation that can continue into motion.",
        "This is a production reference frame for a video model, not key art. Use a single coherent camera view. Do not include a title card, captions, interface elements, borders, logos, or watermarks.",
      ].join("\n\n"),
      size: "1536x864",
      quality: "high",
      output_format: "webp",
      output_compression: 86,
      n: 1,
    }),
    signal: AbortSignal.timeout(150_000),
  });
  const body = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
  return { body, response };
}

export async function POST(request: Request): Promise<Response> {
  if (!isDevSurface()) return unavailable();

  const apiKey = request.headers.get("x-openai-api-key")?.trim() || "";
  if (!apiKey || apiKey.length > 512) {
    return Response.json({ error: "Enter a valid OpenAI API key" }, { status: 400 });
  }

  const input = (await request.json().catch(() => null)) as SegmentRequest | null;
  let imageDataUrl = typeof input?.imageDataUrl === "string" ? input.imageDataUrl : "";
  const experience = typeof input?.experience === "string" ? input.experience.trim().slice(0, 1200) : "";
  if (!imageDataUrl && !experience) {
    return Response.json({ error: "Describe the experience or attach a reference frame" }, { status: 400 });
  }
  if (imageDataUrl && !/^data:image\/(?:jpeg|png|webp);base64,/i.test(imageDataUrl)) {
    return Response.json({ error: "Attach a JPEG, PNG, or WebP reference frame" }, { status: 400 });
  }
  if (imageDataUrl && imageBytes(imageDataUrl) > MAX_IMAGE_BYTES) {
    return Response.json({ error: "The prepared reference frame is larger than 5 MB" }, { status: 413 });
  }

  try {
    let generatedOpeningFrame = false;
    if (!imageDataUrl) {
      const imageResult = await generateOpeningFrame(apiKey, experience);
      if (!imageResult.response.ok) {
        const detail = imageResult.body.error?.message || "OpenAI could not generate an opening frame";
        return Response.json({ error: cleanGeneratedText(detail, 280) }, { status: imageResult.response.status });
      }
      const imageBase64 = imageResult.body.data?.[0]?.b64_json;
      if (!imageBase64) {
        return Response.json({ error: "OpenAI returned no opening frame" }, { status: 502 });
      }
      imageDataUrl = `data:image/webp;base64,${imageBase64}`;
      if (imageBytes(imageDataUrl) > MAX_IMAGE_BYTES) {
        return Response.json({ error: "The generated opening frame is larger than 5 MB" }, { status: 502 });
      }
      generatedOpeningFrame = true;
    }

    for (const [index, model] of MODEL_ORDER.entries()) {
      const result = await generateSegment(apiKey, model, imageDataUrl, experience);
      if (!result.response.ok) {
        if (index < MODEL_ORDER.length - 1 && shouldTryFallback(result.response.status, result.body as OpenAIError)) continue;
        const detail = (result.body as OpenAIError).error?.message || "OpenAI could not generate this segment";
        return Response.json({ error: cleanGeneratedText(detail, 280) }, { status: result.response.status });
      }

      const outputText = readOutputText(result.body as OpenAIResponse);
      if (!outputText) return Response.json({ error: "OpenAI returned no segment plan" }, { status: 502 });
      const parsed = JSON.parse(outputText) as Record<string, unknown>;
      if (
        typeof parsed.title !== "string" ||
        typeof parsed.imageAnalysis !== "string" ||
        typeof parsed.startingPrompt !== "string" ||
        typeof parsed.continuityNotes !== "string" ||
        typeof parsed.voicePrompt !== "string"
      ) {
        return Response.json({ error: "OpenAI returned an incomplete segment plan" }, { status: 502 });
      }
      return Response.json({
        title: cleanGeneratedText(parsed.title, 80),
        imageAnalysis: cleanGeneratedText(parsed.imageAnalysis, 1800),
        startingPrompt: cleanGeneratedText(parsed.startingPrompt, 800),
        continuityNotes: cleanGeneratedText(parsed.continuityNotes, 1600),
        voicePrompt: cleanGeneratedText(parsed.voicePrompt, 360),
        model: (result.body as OpenAIResponse).model || model,
        imageModel: generatedOpeningFrame ? IMAGE_MODEL : null,
        openingFrameDataUrl: generatedOpeningFrame ? imageDataUrl : null,
      }, { headers: { "cache-control": "no-store" } });
    }
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError"
      ? "OpenAI took too long to answer"
      : "Could not reach OpenAI";
    return Response.json({ error: detail }, { status: 502 });
  }

  return Response.json({ error: "No OpenAI model was available" }, { status: 502 });
}
