import { MAX_PROOF_FILES, proofFileProblem } from "@workspace/shared";

/** How many leading bytes the type check reads; the longest signature (WebP, HEIC) needs 12. */
const HEAD_BYTES = 16;

/** The files picked or dropped, split into those that may be attached and why the rest may not. */
export interface PickedProofFiles {
  accepted: File[];
  /** One sentence per file left out, in the words the server uses. */
  refused: string[];
}

/**
 * Checks newly picked proof files in the browser by their first bytes and size, with the same rule
 * the server applies on save (spec Appendix A "check the real file type, not just the extension";
 * click-through #12), so a text file renamed .jpg is refused when it is picked, not on Save. Files
 * beyond the limit of three are left out with a reason too. The server still checks every file.
 */
export async function checkPickedProofFiles(already: number, picked: readonly File[]): Promise<PickedProofFiles> {
  const accepted: File[] = [];
  const refused: string[] = [];
  for (const file of picked) {
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    const problem = proofFileProblem({ name: file.name, size: file.size, head });
    if (problem) refused.push(`${problem} It was not attached.`);
    else if (already + accepted.length >= MAX_PROOF_FILES)
      refused.push(`${file.name} was not attached: attach at most ${MAX_PROOF_FILES} files.`);
    else accepted.push(file);
  }
  return { accepted, refused };
}
