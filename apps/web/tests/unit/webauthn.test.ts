import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertionJSON,
  ceremonyMessage,
  createPasskey,
  creationOptions,
  fromBase64Url,
  PasskeyCeremonyError,
  registrationJSON,
  requestOptions,
  signWithPasskey,
  toBase64Url,
  type CreationOptionsJSON,
} from "@/lib/session/webauthn";

/** ADR 0060, section 2: the browser's half of a passkey ceremony, with no WebAuthn library. */

const bytes = (...values: number[]) => new Uint8Array(values);

const CREATION: CreationOptionsJSON = {
  challenge: "AQIDBA",
  rp: { name: "Flooring Platform", id: "localhost" },
  user: { id: "dXNlci0x", name: "dana.whitfield@summitfloor.example", displayName: "Dana Whitfield" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  timeout: 60_000,
  attestation: "none",
  excludeCredentials: [{ id: "-_8", type: "public-key", transports: ["internal"] }],
  authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
};

function fakeCredential(response: object) {
  return {
    id: "Y3JlZA",
    rawId: bytes(99, 114, 101, 100).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
    response,
  } as unknown as PublicKeyCredential;
}

afterEach(() => vi.unstubAllGlobals());

describe("base64url", () => {
  it("WA1 round-trips bytes with no padding, using - and _", () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    const text = toBase64Url(all);
    expect(text).not.toMatch(/[+/=]/);
    expect([...fromBase64Url(text)]).toEqual([...all]);
    expect(toBase64Url(bytes(251, 255))).toBe("-_8");
    expect([...fromBase64Url("-_8")]).toEqual([251, 255]);
    expect([...fromBase64Url("-_8=")]).toEqual([251, 255]);
  });
});

describe("options from the API", () => {
  it("WA2 registration: the challenge, user id and excluded ids become bytes; the rest passes through", () => {
    const options = creationOptions(CREATION);
    expect([...(options.challenge as Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect(new TextDecoder().decode(options.user.id as Uint8Array)).toBe("user-1");
    expect([...(options.excludeCredentials![0]!.id as Uint8Array)]).toEqual([251, 255]);
    expect(options.excludeCredentials![0]!.transports).toEqual(["internal"]);
    expect(options.authenticatorSelection).toEqual({ residentKey: "preferred", userVerification: "required" });
    expect(options.rp).toEqual({ name: "Flooring Platform", id: "localhost" });
  });

  it("WA3 sign-in: the challenge and allowed ids become bytes", () => {
    const options = requestOptions({
      challenge: "AQID",
      rpId: "localhost",
      userVerification: "required",
      allowCredentials: [{ id: "AQ", type: "public-key" }],
    });
    expect([...(options.challenge as Uint8Array)]).toEqual([1, 2, 3]);
    expect([...(options.allowCredentials![0]!.id as Uint8Array)]).toEqual([1]);
    expect(options.userVerification).toBe("required");
    expect(requestOptions({ challenge: "AQ" }).allowCredentials).toBeUndefined();
  });
});

describe("answers to the API", () => {
  it("WA4 a new credential becomes the plugin client's JSON body", () => {
    const json = registrationJSON(
      fakeCredential({
        clientDataJSON: bytes(1).buffer,
        attestationObject: bytes(2).buffer,
        getTransports: () => ["internal", "hybrid"],
      }),
    );
    expect(json).toEqual({
      id: "Y3JlZA",
      rawId: "Y3JlZA",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: "AQ", attestationObject: "Ag", transports: ["internal", "hybrid"] },
    });
  });

  it("WA5 an assertion becomes the plugin client's JSON body; a missing user handle is left out", () => {
    const response = { clientDataJSON: bytes(1).buffer, authenticatorData: bytes(2).buffer, signature: bytes(3).buffer };
    expect(assertionJSON(fakeCredential({ ...response, userHandle: bytes(4).buffer })).response).toEqual({
      clientDataJSON: "AQ",
      authenticatorData: "Ag",
      signature: "Aw",
      userHandle: "BA",
    });
    expect(assertionJSON(fakeCredential({ ...response, userHandle: null })).response.userHandle).toBeUndefined();
  });
});

describe("the browser's prompt", () => {
  function stubBrowser(credentials: Partial<CredentialsContainer>) {
    vi.stubGlobal("window", { PublicKeyCredential: function PublicKeyCredential() {} });
    vi.stubGlobal("navigator", { credentials });
  }

  it("WA6 each browser refusal is named in plain words", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(ceremonyMessage(named("NotAllowedError"))).toMatch(/closed or timed out/);
    expect(ceremonyMessage(named("InvalidStateError"))).toMatch(/already has a passkey/);
    expect(ceremonyMessage(named("SecurityError"))).toMatch(/cannot use passkeys/);
    expect(ceremonyMessage(named("Whatever"))).toBe("The passkey prompt did not finish. Try again.");
  });

  it("WA7 a browser without WebAuthn is told so, and nothing is asked", async () => {
    vi.stubGlobal("window", {});
    await expect(createPasskey(CREATION)).rejects.toThrow("This browser cannot use passkeys.");
    await expect(createPasskey(CREATION)).rejects.toBeInstanceOf(PasskeyCeremonyError);
  });

  it("WA8 a cancelled prompt becomes a PasskeyCeremonyError with words, never the browser's text", async () => {
    stubBrowser({ create: async () => Promise.reject(Object.assign(new Error("raw"), { name: "NotAllowedError" })) });
    const failure = await createPasskey(CREATION).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PasskeyCeremonyError);
    expect((failure as Error).message).toMatch(/closed or timed out/);
  });

  it("WA9 create and get send the converted options as `publicKey` and answer the JSON", async () => {
    const create = vi.fn(async () =>
      fakeCredential({ clientDataJSON: bytes(1).buffer, attestationObject: bytes(2).buffer, getTransports: () => [] }),
    );
    const get = vi.fn(async () =>
      fakeCredential({
        clientDataJSON: bytes(1).buffer,
        authenticatorData: bytes(2).buffer,
        signature: bytes(3).buffer,
        userHandle: null,
      }),
    );
    stubBrowser({ create, get } as unknown as Partial<CredentialsContainer>);
    expect((await createPasskey(CREATION)).response.attestationObject).toBe("Ag");
    const sent = (create.mock.calls[0] as unknown as [CredentialCreationOptions])[0];
    expect([...(sent.publicKey!.challenge as Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect((await signWithPasskey({ challenge: "AQ" })).response.signature).toBe("Aw");
    expect(get).toHaveBeenCalledOnce();
  });

  it("WA10 an empty answer is refused", async () => {
    stubBrowser({ get: async () => null });
    await expect(signWithPasskey({ challenge: "AQ" })).rejects.toBeInstanceOf(PasskeyCeremonyError);
  });
});
