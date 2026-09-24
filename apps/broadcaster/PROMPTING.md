# FastH3 prompt compiler

## Contract

FastH3 receives one plain-prose prompt of at most 800 characters. Cerebras returns visual action, one optional named speaker and spoken line, and a short soundscape. The compiler owns formatting and budget enforcement, not the language model. It never clips a sentence or cuts dialogue to fit. Invalid output gets one complete rewrite under the same wall-clock deadline, then fails explicitly.

On the first plan for a supplied cast, Cerebras reduces each recurring voice to distinguishing acoustic traits: name at most 32 characters, description at most 64. Descriptions are cached unchanged in the supervisor for subsequent chunks. Only the selected speaker's description enters the video prompt, outside quoted dialogue. Silent chunks omit all voice descriptions. Existing verbose workshop drafts do not need migration. The cache is process-local, so a new supervisor session can recompile a draft's cast.

For Peace Talks, continuing geometry uses 137 characters at 2.9 m, versus 227 previously. Voice descriptions use at most 64 characters for one speaker, versus a 297-character two-speaker disclaimer block. Extra speaker attribution and dialogue punctuation still count toward the full 800-character limit. The visual field cannot supply another numeric measurement over the application's geometry.

Only actual compiled prompts enter the next planning request. History is explicitly labelled as instructions, not observed footage. The retained summary is derived from compiled visual/geometry instructions, not an independent invented result. Native `continue_from_clip_id` remains the visual anchor; this work does not add rendered-frame observation or repair failed clip ancestry.

## Audience choice direction

The voting-only policy in src/vote-options.ts asks for bold, recognizable character antics, not nods, glances or slightly different prop handling. Four short labels name the actor, action and target. A ridiculous power move, physical gag, harmless social disaster and character-specific wildcard each need a surprising visual payoff. A same-call self-check rewrites ordinary acting notes and labels that promise more than their direction delivers. They offer distinct visual outcomes without changing the show's cast, setting or world rules. Directions must deliver the label's promise in one chunk and remain valid after the voting window and buffered media.

The winning beat receives explicit instructions to stage that action at the chosen scale, without substituting hesitation or preparation. Ordinary text-mode continuation keeps its existing restrained policy. This changes instructions, not sampling parameters, call count, output limits, voting timing or persisted segments. Mocked tests verify policy routing and winner handoff; how often live options achieve the intended energy still needs viewing. No numerical increase in creativity is claimed.

## Model comparison, 2026-09-04

Official catalog: https://inference-docs.cerebras.ai/models/overview

Reasoning parameters: https://inference-docs.cerebras.ai/capabilities/reasoning

The authenticated model list exposed `gpt-oss-120b`, `qwen-3.8-27b`, and `gemma-4-31b`. Account availability can differ from the public catalog. No GLM model appeared in this account's list.

The text-only benchmark uses three synthetic fixtures, each with two successive chunks: Morgan's raincloud, the extending diplomatic table, and a host holding an unpressed button with a legacy identity-only voice note. It never submits those prompts to Reactor.

First pass, 24 plans:

- GPT-OSS 120B low: fastest, but changed the table target from 2.9 m to 2.7 m, passed a celebrity name as the voice description and pressed a prohibited button.
- GPT-OSS 120B medium: still used the celebrity name and pressed the button.
- Qwen 3.8 27B low: preserved the numeric target and unpressed button, translated the legacy voice into acoustic traits, with all six plans under 2.5 seconds.
- Gemma 4 31B low: preserved these constraints too, but introduced an unseen contestant in the host fixture. All six plans took about 0.7-1.0 seconds.

After adding acoustic-name validation, reserved-geometry instructions, and an explicit reminder that continuation cannot override the constitution, the second pass compared Qwen low with GPT-OSS medium again:

| Variant | Valid plans | End-to-end latency range |
| --- | --- | --- |
| Qwen 3.8 27B low | 6/6 | 493-2712 ms |
| GPT-OSS 120B medium | 6/6 | 492-1589 ms |

Both preserved the tested target and prohibited button in the second pass. Qwen's description of the identity-only voice was closer to the requested energetic host than GPT-OSS's low, gravelly, measured description. Qwen low is the default on this task-specific evidence. GPT-OSS remains an environment override. These are tiny, non-deterministic samples with no blind scoring; they do not establish broad model superiority. None of these timings measures FastH3 generation, audiovisual quality, or sustained rate-limit behavior.

Next quality gate: compare rendered clips with identical opening images, seeds and lengths. Inspect identity drift, geometric behavior, spoken-word accuracy and voice consistency. Prompt validation cannot establish any of those by itself.
