"use server";

import { isValidFakeViewerCount, MAX_FAKE_VIEWERS, normalizeChatMessageTypes } from "@reactor/infinite-contracts";
import { ConvexHttpClient } from "convex/browser";
import { getBackend } from "@/lib/backend";
import { anyApi } from "convex/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatePromptCriteria } from "../../../convex/lib/promptModerationPolicy";

import {
  clearAdminSession,
  isAdminAuthenticated,
  isAdminPassword,
  setAdminSession,
} from "@/lib/admin-auth";

export type AdminActionState = {
  error?: string;
  success?: string;
};

export type PromptModerationActionState = AdminActionState & { revision: number };

export async function savePromptModeration(
  state: PromptModerationActionState,
  formData: FormData,
): Promise<PromptModerationActionState> {
  const failure = (error: string) => ({ revision: state.revision, error });
  if (!(await isAdminAuthenticated())) return failure("Your admin session has expired.");
  let criteria: string[];
  try { criteria = validatePromptCriteria(formData.getAll("criteria")); }
  catch (error) { return failure((error as Error).message); }
  const revisionValue = formData.get("revision");
  const expectedRevision = Number(revisionValue);
  if (typeof revisionValue !== "string" || !revisionValue.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return failure("Reload moderation settings before saving.");
  try {
    const backend = await getBackend();
    if (backend.switchable && formData.get("backend") !== backend.target) return failure("Backend changed. Reload before saving.");
    if (!backend.secret) return failure("The selected backend has no server credential configured.");
    const result = await new ConvexHttpClient(backend.convexUrl).mutation(anyApi.settings.setPromptModeration, {
      secret: backend.secret, criteria, expectedRevision,
    });
    if (result.status === "conflict") return failure("Another admin changed the criteria. Reload this page before saving. Your changes have not been applied.");
    revalidatePath("/admin");
    return { revision: result.revision, success: "Prompt moderation saved. New submissions use these criteria immediately." };
  } catch {
    return failure("Prompt moderation could not be saved. Please try again.");
  }
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^.*Uncaught Error: /, "");
}

export async function login(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const password = formData.get("password");
  try {
    if (typeof password !== "string" || !isAdminPassword(password)) {
      return { error: "That password is not authorized." };
    }
    await setAdminSession();
  } catch (error) {
    return { error: cleanError(error) };
  }
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await clearAdminSession();
  redirect("/admin");
}

export async function saveSettings(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!(await isAdminAuthenticated())) return { error: "Your admin session has expired." };

  const chunkSeconds = Number(formData.get("chunkSeconds"));
  const interactionMode = formData.get("interactionMode");
  const voteDurationChunks = Number(formData.get("voteDurationChunks"));
  const fakeViewersValue = formData.get("num_fake_viewers");
  const num_fake_viewers = fakeViewersValue === null ? undefined : Number(fakeViewersValue);
  if (fakeViewersValue !== null && (typeof fakeViewersValue !== "string" || !fakeViewersValue.trim() || !isValidFakeViewerCount(num_fake_viewers))) {
    return { error: `num_fake_viewers must be a whole number from 0 to ${MAX_FAKE_VIEWERS}.` };
  }
  if (interactionMode !== "prompts" && interactionMode !== "voting") return { error: "Choose an audience interaction mode." };
  if (!Number.isInteger(voteDurationChunks) || voteDurationChunks < 1 || voteDurationChunks > 12) return { error: "Vote duration must be 1 to 12 chunks." };
  const bannerValue = formData.get("banner");
  const banner = typeof bannerValue === "string" ? bannerValue : "";
  if (!Number.isInteger(chunkSeconds) || chunkSeconds < 6 || chunkSeconds > 14) {
    return { error: "Chunk length must be a whole number from 6 to 14 seconds." };
  }
  if (banner.length > 240) return { error: "The banner must be 240 characters or fewer." };

  try {
    const backend = await getBackend();
    if (backend.switchable && formData.get("backend") !== backend.target) return { error: "Backend changed. Reload before saving." };
    const { secret, convexUrl } = backend;
    if (!secret) return { error: "The selected backend has no server credential configured." };
    await new ConvexHttpClient(convexUrl).mutation(anyApi.settings.update, {
      secret,
      chunkSeconds,
      banner,
      interactionMode,
      voteDurationChunks,
      num_fake_viewers,
    });
    revalidatePath("/admin");
    revalidatePath("/");
    return { success: "Settings saved. Mode changes affect upcoming beats; vote duration applies to new rounds." };
  } catch (error) {
    return { error: cleanError(error) };
  }
}

export async function saveChatMessageSettings(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!(await isAdminAuthenticated())) return { error: "Your admin session has expired." };
  const values = formData.getAll("enabledTypes");
  if (values.some(value => typeof value !== "string")) return { error: "Invalid chat message types." };
  const enabledTypes = normalizeChatMessageTypes(values as string[]);
  if (values.some(value => !enabledTypes.some(type => type === value))) return { error: "Unknown chat message type." };
  try {
    const backend = await getBackend();
    if (backend.switchable && formData.get("backend") !== backend.target) return { error: "Backend changed. Reload before saving." };
    if (!backend.secret) return { error: "The selected backend has no server credential configured." };
    await new ConvexHttpClient(backend.convexUrl).mutation(anyApi.settings.setChatMessageTypes, {
      secret: backend.secret, enabledTypes,
    });
    revalidatePath("/admin");
    return { success: enabledTypes.length ? "Chat message visibility saved for all viewers." : "All Reactor TV notices are hidden for all viewers." };
  } catch {
    return { error: "Chat visibility could not be saved. Please try again." };
  }
}
