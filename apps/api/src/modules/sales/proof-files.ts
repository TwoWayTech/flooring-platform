import { BadRequestException, Logger } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { attachments } from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import { detectProofType, MAX_PROOF_FILES, proofFilesProblem, type ProofType } from "@workspace/shared";
import { v7 as uuidv7 } from "uuid";

/** A proof file as the screen sends it: its name and its bytes in base64 (ADR 0038). */
export interface ProofUpload {
  name: string;
  data: string;
}

/** A proof file whose real type and size were checked. */
export interface CheckedProof {
  name: string;
  type: ProofType;
  bytes: Uint8Array;
}

/** A proof file written to storage, before its attachment row exists. */
interface StoredProof extends CheckedProof {
  id: string;
  key: string;
}

/** Strict base64: the alphabet and padding only, so nothing else is quietly dropped while decoding. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const logger = new Logger("ProofFiles");

/**
 * Decodes and checks proof files (spec rule 27): 1 to 3 in all with the ones already kept, each at
 * most 5 MB and a PDF, JPG, PNG, WebP or HEIC by its first bytes, never by its name.
 */
export function checkProofs(files: readonly ProofUpload[], already = 0): CheckedProof[] {
  const decoded = files.map((file) => {
    if (!BASE64.test(file.data) || file.data.length % 4 !== 0) {
      throw new BadRequestException({ code: "invalid_request", message: `${file.name} could not be read.` });
    }
    return { name: file.name.trim() || "proof", bytes: new Uint8Array(Buffer.from(file.data, "base64")) };
  });
  const problem = proofFilesProblem(
    decoded.map((file) => ({ name: file.name, size: file.bytes.length, head: file.bytes.subarray(0, 16) })),
  );
  if (problem) throw new BadRequestException({ code: "invalid_request", message: problem });
  if (already + decoded.length > MAX_PROOF_FILES) {
    throw new BadRequestException({
      code: "invalid_request",
      message: `A record keeps at most ${MAX_PROOF_FILES} files.`,
    });
  }
  return decoded.map((file) => ({ ...file, type: detectProofType(file.bytes)! }));
}

/**
 * Writes the files under the company's own prefix, runs `save` (which records them in its
 * transaction through `attach`), and removes every written file when anything fails, so a
 * record never points at a missing file and no file is left without a record (spec rule 27).
 */
export async function withStoredProofs<T>(
  storage: StorageProvider,
  companyId: string,
  files: readonly CheckedProof[],
  save: (
    attach: (tx: CompanyDb, ownerType: "payment" | "refund", ownerId: string, by: string) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const stored: StoredProof[] = [];
  try {
    for (const file of files) {
      const id = uuidv7();
      // Keys start with the company id, so one company's files never share a prefix with another's.
      const key = `${companyId}/proof/${id}`;
      await storage.put(key, file.bytes, file.type);
      stored.push({ ...file, id, key });
    }
    return await save(async (tx, ownerType, ownerId, by) => {
      if (stored.length === 0) return;
      await tx.insert(attachments).values(
        stored.map((file) => ({
          id: file.id,
          ownerType,
          ownerId,
          purpose: "proof",
          storageKey: file.key,
          name: file.name,
          contentType: file.type,
          size: file.bytes.length,
          createdBy: by,
        })),
      );
    });
  } catch (error) {
    await Promise.all(stored.map((file) => storage.delete(file.key))).catch(() =>
      logger.warn("Proof files of a failed save could not all be removed."),
    );
    throw error;
  }
}
