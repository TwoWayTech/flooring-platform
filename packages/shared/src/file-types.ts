/** The file types accepted as proof of payment (spec Appendix A "Proof of payment"). */
export type ProofType = "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/heic";

/** At most this many proof files on one payment. */
export const MAX_PROOF_FILES = 3;
/** Each proof file at most 5 MB. */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/**
 * The real type of a file from its first bytes, not its name (spec Appendix A: "check the real
 * file type, not just the extension"), or null when it is not an accepted proof type.
 */
export function detectProofType(bytes: Uint8Array): ProofType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1", "heif"].includes(ascii(bytes, 8, 12)))
    return "image/heic";
  return null;
}

/** A proof file as checked before it is stored. */
export interface ProofCandidate {
  name: string;
  size: number;
  /** The first 16 bytes or more, for detectProofType. */
  head: Uint8Array;
}

/**
 * Why a set of proof files cannot be saved, or null when it can (spec Appendix A): at least one
 * file, at most three, each at most 5 MB and of an accepted type.
 */
export function proofFilesProblem(files: readonly ProofCandidate[]): string | null {
  if (files.length === 0) return "Attach the receipt, bank confirmation or check photo to continue.";
  if (files.length > MAX_PROOF_FILES) return `Attach at most ${MAX_PROOF_FILES} files.`;
  for (const file of files) {
    if (file.size > MAX_PROOF_BYTES) return `${file.name} is larger than 5 MB.`;
    if (!detectProofType(file.head)) return `${file.name} is not a PDF, JPG, PNG, WebP or HEIC file.`;
  }
  return null;
}
