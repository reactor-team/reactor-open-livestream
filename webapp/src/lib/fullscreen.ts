export type FullscreenDocument = Pick<Document, "fullscreenElement" | "fullscreenEnabled" | "exitFullscreen"> & {
  documentElement: Pick<HTMLElement, "requestFullscreen">;
};

export function toggleBrowserFullscreen(doc: FullscreenDocument): Promise<void> {
  if (doc.fullscreenElement) return doc.exitFullscreen();
  if (!doc.fullscreenEnabled || typeof doc.documentElement.requestFullscreen !== "function") {
    return Promise.reject(new Error("Fullscreen is unavailable"));
  }
  // Request the whole document so body-level toasts and dialogs stay visible.
  return doc.documentElement.requestFullscreen({ navigationUI: "hide" });
}
