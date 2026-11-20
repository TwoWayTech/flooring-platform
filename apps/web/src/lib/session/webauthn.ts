import { ApiError } from "@/lib/api/errors";

/**
 * The browser's half of a passkey ceremony, without a WebAuthn library (ADR 0060, section 2). The
 * API (Better Auth's passkey plugin) sends options as JSON with binary fields in base64url; the
 * browser wants bytes. The answer goes back as the same JSON body the plugin's own client sends.
 */

/** Registration options as `/passkey/generate-register-options` answers them. */
export interface CreationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: CredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  extensions?: AuthenticationExtensionsClientInputs;
}

/** Sign-in options as `/passkey/generate-authenticate-options` answers them. */
export interface RequestOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: CredentialDescriptorJSON[];
  extensions?: AuthenticationExtensionsClientInputs;
}

/** A credential the options name, by its base64url id. */
export interface CredentialDescriptorJSON {
  id: string;
  type: "public-key";
  transports?: AuthenticatorTransport[];
}

/** What `/passkey/verify-registration` and `/passkey/verify-authentication` read as `response`. */
export interface CredentialJSON {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment?: string;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  response: Record<string, string | string[] | undefined>;
}

/** Why the browser's prompt did not give a passkey, in the person's words. */
export class PasskeyCeremonyError extends ApiError {}

/** Bytes as base64url with no padding, the encoding WebAuthn JSON uses. */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url (padded or not) back to bytes. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function descriptors(list: CredentialDescriptorJSON[] | undefined): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((item) => ({ id: fromBase64Url(item.id), type: item.type, transports: item.transports }));
}

/** The API's registration options as `navigator.credentials.create` takes them. */
export function creationOptions(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: fromBase64Url(json.challenge),
    user: { ...json.user, id: fromBase64Url(json.user.id) },
    excludeCredentials: descriptors(json.excludeCredentials),
  };
}

/** The API's sign-in options as `navigator.credentials.get` takes them. */
export function requestOptions(json: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return { ...json, challenge: fromBase64Url(json.challenge), allowCredentials: descriptors(json.allowCredentials) };
}

function optional(bytes: ArrayBuffer | null | undefined): string | undefined {
  return bytes ? toBase64Url(bytes) : undefined;
}

/** A new credential as the JSON body the API verifies. */
export function registrationJSON(credential: PublicKeyCredential): CredentialJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}

/** A sign-in assertion as the JSON body the API verifies. */
export function assertionJSON(credential: PublicKeyCredential): CredentialJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: optional(response.userHandle),
    },
  };
}

/** Words for the browser's refusals, by the DOMException name (WebAuthn, "Create" and "Get"). */
const CEREMONY_MESSAGES: Record<string, string> = {
  NotAllowedError: "The passkey prompt was closed or timed out. Try again when you are ready.",
  InvalidStateError: "This device already has a passkey for your account. Use it, or add one on another device.",
  SecurityError: "This address cannot use passkeys. Open the app on its usual address and try again.",
  NotSupportedError: "This device cannot make a passkey that the app accepts. Try another device or a security key.",
  AbortError: "The passkey prompt was closed. Try again when you are ready.",
};

const UNSUPPORTED_MESSAGE = "This browser cannot use passkeys. Update it, or use another browser or device.";

/** The person's words for a failed `create` or `get`. */
export function ceremonyMessage(failure: unknown): string {
  const name = failure instanceof Error ? failure.name : "";
  return CEREMONY_MESSAGES[name] ?? "The passkey prompt did not finish. Try again.";
}

/** Whether this browser offers WebAuthn at all. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

async function ceremony(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  if (!passkeysSupported()) throw new PasskeyCeremonyError(UNSUPPORTED_MESSAGE);
  let credential: Credential | null;
  try {
    credential = await run();
  } catch (failure) {
    throw new PasskeyCeremonyError(ceremonyMessage(failure));
  }
  if (!credential || credential.type !== "public-key") throw new PasskeyCeremonyError(ceremonyMessage(null));
  return credential as PublicKeyCredential;
}

/** Shows the browser's prompt to make a passkey and returns it as the API's JSON. */
export async function createPasskey(options: CreationOptionsJSON): Promise<CredentialJSON> {
  const credential = await ceremony(() => navigator.credentials.create({ publicKey: creationOptions(options) }));
  return registrationJSON(credential);
}

/** Shows the browser's prompt to sign in with a passkey and returns the assertion as the API's JSON. */
export async function signWithPasskey(options: RequestOptionsJSON): Promise<CredentialJSON> {
  const credential = await ceremony(() => navigator.credentials.get({ publicKey: requestOptions(options) }));
  return assertionJSON(credential);
}
