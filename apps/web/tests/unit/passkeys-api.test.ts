import { describe, expect, it, vi } from "vitest";
import { defaultPasskeyName, PASSKEY_NAME_MAX, passkeyNameProblem } from "@/lib/session/passkeys";
import { fakeApi, type FakeAnswer } from "./fake-api";

/**
 * Sign-in and security on the API (ADR 0060): the calls go to Better Auth's endpoints under
 * /api/auth (the proxy's vouched route), the password comes first, and every refusal the screens
 * meet is shown in plain words by its code (docs/api-contract.md, Authentication).
 */

const NEW_CREDENTIAL = { id: "Y3JlZA", rawId: "Y3JlZA", type: "public-key", response: {}, clientExtensionResults: {} };
const ceremony = vi.hoisted(() => ({ create: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/session/webauthn", () => ({ createPasskey: ceremony.create, signWithPasskey: ceremony.sign }));
ceremony.create.mockResolvedValue(NEW_CREDENTIAL);
ceremony.sign.mockResolvedValue(NEW_CREDENTIAL);

const refusal = (status: number, code?: string, message = "raw"): FakeAnswer => ({
  status,
  body: code ? { code, message } : { message },
});

const PASSKEY_ROW = {
  id: "pk-2",
  name: "Office laptop",
  createdAt: "2026-11-20T10:00:00.000Z",
  backedUp: false,
  publicKey: "secret-looking-bytes",
  credentialID: "cred",
  userId: "u-1",
};

describe("passkey calls on the API", () => {
  it("PK1 confirming the password posts it to /api/auth/verify-password and reads nothing again", async () => {
    const fake = fakeApi();
    await fake.client.confirmPassword("correct horse");
    expect(fake.sent).toEqual([{ call: "POST /api/auth/verify-password", body: { password: "correct horse" } }]);
    expect(fake.changes()).toBe(0);
  });

  it("PK2 a wrong password, the account lock and the per-IP limit each have their words", async () => {
    const wrong = fakeApi({ "POST /api/auth/verify-password": refusal(401, "INVALID_PASSWORD", "Invalid password") });
    await expect(wrong.client.confirmPassword("x")).rejects.toThrow("That password is not right. Check it and try again.");
    const locked = fakeApi({
      "POST /api/auth/verify-password": refusal(429, "account_locked", "Too many wrong passwords. Try again in 15 minutes."),
    });
    await expect(locked.client.confirmPassword("x")).rejects.toThrow("Too many wrong passwords. Try again in 15 minutes.");
    const limited = fakeApi({ "POST /api/auth/verify-password": refusal(429) });
    await expect(limited.client.confirmPassword("x")).rejects.toThrow(
      "Too many attempts from this network. Wait a minute, then try again.",
    );
  });

  it("PK3 adding asks for options with no name query, then sends the answer and the trimmed name, never createSession", async () => {
    ceremony.create.mockClear();
    const fake = fakeApi({ "GET /api/auth/passkey/generate-register-options": { status: 200, body: { challenge: "AQ" } } });
    await fake.client.addPasskey("  Office laptop  ");
    expect(fake.sent).toEqual([
      { call: "GET /api/auth/passkey/generate-register-options", body: undefined },
      { call: "POST /api/auth/passkey/verify-registration", body: { response: NEW_CREDENTIAL, name: "Office laptop" } },
    ]);
    expect(ceremony.create).toHaveBeenCalledWith({ challenge: "AQ" });
  });

  it("PK4 without a fresh password check or a fresh sign-in, adding is refused in plain words and no prompt shows", async () => {
    ceremony.create.mockClear();
    const stale = fakeApi({
      "GET /api/auth/passkey/generate-register-options": refusal(403, "password_confirmation_required"),
    });
    await expect(stale.client.addPasskey("Laptop")).rejects.toThrow(
      "Your password check has run out. Confirm your password again, then add the passkey within 5 minutes.",
    );
    const old = fakeApi({ "GET /api/auth/passkey/generate-register-options": refusal(403, "SESSION_NOT_FRESH") });
    await expect(old.client.addPasskey("Laptop")).rejects.toThrow(
      "A passkey can be added only in the first 10 minutes after you sign in. Sign out, sign in again, then add it.",
    );
    expect(ceremony.create).not.toHaveBeenCalled();
  });

  it("PK5 a refused registration is shown in words, and a name out of bounds sends nothing", async () => {
    const fake = fakeApi({
      "GET /api/auth/passkey/generate-register-options": { status: 200, body: {} },
      "POST /api/auth/passkey/verify-registration": refusal(400, "FAILED_TO_VERIFY_REGISTRATION"),
    });
    await expect(fake.client.addPasskey("Laptop")).rejects.toThrow("The passkey could not be checked.");
    const empty = fakeApi();
    await expect(empty.client.addPasskey("   ")).rejects.toThrow("Enter a name, such as the device it is on.");
    await expect(empty.client.renamePasskey("pk-1", "x".repeat(PASSKEY_NAME_MAX + 1))).rejects.toThrow(
      "Use 60 characters or fewer.",
    );
    expect(empty.sent).toEqual([]);
  });

  it("PK6 the security read joins the MFA state with the passkeys, keeping only what the page shows, oldest first", async () => {
    const fake = fakeApi({
      "GET /auth/context": {
        status: 200,
        body: { user: {}, company: null, companies: [], mfa: { required: true, totp: false, passkeys: 2, state: "ok" } },
      },
      "GET /api/auth/passkey/list-user-passkeys": {
        status: 200,
        body: [PASSKEY_ROW, { ...PASSKEY_ROW, id: "pk-1", name: "", createdAt: "2026-11-19T10:00:00.000Z", backedUp: true }],
      },
    });
    expect(await fake.client.signInSecurity()).toEqual({
      mfaRequired: true,
      totp: false,
      passkeys: [
        { id: "pk-1", name: "Unnamed passkey", createdAt: "2026-11-19T10:00:00.000Z", synced: true },
        { id: "pk-2", name: "Office laptop", createdAt: "2026-11-20T10:00:00.000Z", synced: false },
      ],
    });
    expect(fake.changes()).toBe(0);
  });

  it("PK7 renaming and removing post the id; removing the last factor of a required user says why", async () => {
    const fake = fakeApi({ "POST /api/auth/passkey/delete-passkey": refusal(403, "mfa_required") });
    await fake.client.renamePasskey("pk-1", " Phone ");
    expect(fake.sent[0]).toEqual({ call: "POST /api/auth/passkey/update-passkey", body: { id: "pk-1", name: "Phone" } });
    await expect(fake.client.deletePasskey("pk-1")).rejects.toThrow(
      "Your role needs two-step sign-in, so you cannot remove your last passkey.",
    );
    expect(fake.sent[1]).toEqual({ call: "POST /api/auth/passkey/delete-passkey", body: { id: "pk-1" } });
  });

  it("PK8 an unknown refusal keeps the server's own words and code", async () => {
    const fake = fakeApi({ "POST /api/auth/passkey/delete-passkey": refusal(500, "boom", "Something broke.") });
    await expect(fake.client.deletePasskey("pk-1")).rejects.toMatchObject({ message: "Something broke.", code: "boom" });
  });
});

describe("passkey names", () => {
  it("PK9 a name is 1 to 60 characters once trimmed", () => {
    expect(passkeyNameProblem("Laptop")).toBeNull();
    expect(passkeyNameProblem(` ${"x".repeat(60)} `)).toBeNull();
    expect(passkeyNameProblem("")).not.toBeNull();
    expect(passkeyNameProblem("x".repeat(61))).not.toBeNull();
  });

  it("PK10 the first name comes from the browser and system", () => {
    const windowsChrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(defaultPasskeyName(windowsChrome)).toBe("Chrome on Windows");
    expect(defaultPasskeyName(iphone)).toBe("Safari on iPhone or iPad");
    expect(defaultPasskeyName("")).toBe("My passkey");
  });
});
