import { describe, expect, it } from "vitest";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** The demo's simulated passkeys (ADR 0060): the API's rules, with no browser prompt. */

const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

async function open(userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId: null });
  return store;
}

describe("DemoStore passkeys", () => {
  it("DP1 any password confirms; an empty one is refused", async () => {
    const store = await open(PRIYA);
    await expect(store.confirmPassword("anything")).resolves.toBeUndefined();
    await expect(store.confirmPassword("")).rejects.toThrow("Enter your password.");
  });

  it("DP2 adds, renames and removes passkeys for the signed-in person only, telling screens each time", async () => {
    const store = await open(PRIYA);
    let changes = 0;
    store.subscribe(() => changes++);
    expect(await store.signInSecurity()).toMatchObject({ mfaRequired: false, passkeys: [] });
    await store.addPasskey("  Chrome on Windows ");
    await store.addPasskey("Phone");
    const [first, second] = (await store.signInSecurity()).passkeys;
    expect(first).toMatchObject({ name: "Chrome on Windows", synced: true });
    await store.renamePasskey(first!.id, "Office laptop");
    await store.deletePasskey(second!.id);
    expect((await store.signInSecurity()).passkeys.map((passkey) => passkey.name)).toEqual(["Office laptop"]);
    expect(changes).toBe(4);
    store.setViewer({ userId: DANA, viewAsRoleId: null });
    expect((await store.signInSecurity()).passkeys).toEqual([]);
  });

  it("DP3 names out of bounds and unknown ids are refused", async () => {
    const store = await open(PRIYA);
    await expect(store.addPasskey(" ")).rejects.toThrow("Enter a name");
    await expect(store.addPasskey("x".repeat(61))).rejects.toThrow("60 characters or fewer");
    await expect(store.renamePasskey("nope", "Phone")).rejects.toThrow("no longer on your account");
    await expect(store.deletePasskey("nope")).rejects.toThrow("no longer on your account");
  });

  it("DP4 an Owner without the authenticator app cannot remove the last passkey (the API's mfa_required)", async () => {
    const store = await open(DANA);
    await store.updateUser(DANA, { mfaEnrolled: false });
    await store.addPasskey("Laptop");
    const security = await store.signInSecurity();
    expect(security).toMatchObject({ mfaRequired: true, totp: false });
    await expect(store.deletePasskey(security.passkeys[0]!.id)).rejects.toThrow(
      "Your role needs two-step sign-in, so you cannot remove your last passkey. Add another passkey first, then remove this one.",
    );
    await store.addPasskey("Phone");
    await store.deletePasskey(security.passkeys[0]!.id);
    expect((await store.signInSecurity()).passkeys.map((passkey) => passkey.name)).toEqual(["Phone"]);
  });

  it("DP5 with the authenticator app on, a required person may remove every passkey", async () => {
    const store = await open(DANA);
    await store.updateUser(DANA, { mfaEnrolled: true });
    await store.addPasskey("Laptop");
    const [only] = (await store.signInSecurity()).passkeys;
    await store.deletePasskey(only!.id);
    expect((await store.signInSecurity()).passkeys).toEqual([]);
  });
});
