import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CompanySettings, SettingsAnswer } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import { settingsFromAnswer } from "@/lib/api/http/settings-answer";

// The served sections with one the merge doesn't name: the real types make such a section impossible.
vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return { ...real, API_SETTINGS_SECTIONS: [...real.API_SETTINGS_SECTIONS, "branding"] };
});

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** Summit's settings as DemoStore holds them: the demo half of the merge. */
let demo: CompanySettings;

beforeAll(async () => {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
  demo = structuredClone(await store.getSettings());
});

/**
 * The web merge names every served section in an exhaustive switch (ADR 0059, part 2a, D19): a
 * section the API serves can't be left as DemoStore's copy because the merge forgot it.
 */
describe("the api-mode settings merge takes every served section", () => {
  it("X3 a served section the merge doesn't name is an error, never DemoStore's copy kept silently", () => {
    const answer = { branding: { ...demo.branding, brandColor: "#123456" } } as SettingsAnswer;
    expect(() => settingsFromAnswer(answer, demo)).toThrow('GET /settings has no answer for "branding".');
  });
});
