/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAi from "../adminAi.js";
import type * as broadcast from "../broadcast.js";
import type * as chat from "../chat.js";
import type * as chatMigrations from "../chatMigrations.js";
import type * as lib from "../lib.js";
import type * as lib_chatSocial from "../lib/chatSocial.js";
import type * as lib_promptModeration from "../lib/promptModeration.js";
import type * as lib_promptModerationPolicy from "../lib/promptModerationPolicy.js";
import type * as lib_promptModerationSettings from "../lib/promptModerationSettings.js";
import type * as lib_queueTiming from "../lib/queueTiming.js";
import type * as lib_segmentEnrichment from "../lib/segmentEnrichment.js";
import type * as lib_streamAlerts from "../lib/streamAlerts.js";
import type * as lib_viewerNames from "../lib/viewerNames.js";
import type * as prompts from "../prompts.js";
import type * as schedule from "../schedule.js";
import type * as segments from "../segments.js";
import type * as settings from "../settings.js";
import type * as streamAlerts from "../streamAlerts.js";
import type * as table from "../table.js";
import type * as viewers from "../viewers.js";
import type * as voting from "../voting.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAi: typeof adminAi;
  broadcast: typeof broadcast;
  chat: typeof chat;
  chatMigrations: typeof chatMigrations;
  lib: typeof lib;
  "lib/chatSocial": typeof lib_chatSocial;
  "lib/promptModeration": typeof lib_promptModeration;
  "lib/promptModerationPolicy": typeof lib_promptModerationPolicy;
  "lib/promptModerationSettings": typeof lib_promptModerationSettings;
  "lib/queueTiming": typeof lib_queueTiming;
  "lib/segmentEnrichment": typeof lib_segmentEnrichment;
  "lib/streamAlerts": typeof lib_streamAlerts;
  "lib/viewerNames": typeof lib_viewerNames;
  prompts: typeof prompts;
  schedule: typeof schedule;
  segments: typeof segments;
  settings: typeof settings;
  streamAlerts: typeof streamAlerts;
  table: typeof table;
  viewers: typeof viewers;
  voting: typeof voting;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
