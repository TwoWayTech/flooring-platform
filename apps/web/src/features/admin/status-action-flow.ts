import {
  ADMIN_REASON_MESSAGE,
  STATUS_ACTION_MESSAGES,
  statusActionInputProblem,
  type CompanyStatusAction,
  type CompanyStatusInput,
} from "@workspace/shared";
import { apiErrorCode } from "@/lib/api/errors";

/*
 * The status dialog's steps without the screen (docs/specs/platform-admin.md, part 2, "The status
 * dialog"): what Continue checks before the step-up, what success says, and what a refusal does.
 */

/** A field of the status dialog that a refusal can point at. */
export type StatusField = "reason" | "confirmName";

/** What the admin typed in the status dialog. */
export interface StatusDraft {
  reason: string;
  confirmName: string;
}

/** What Continue found: the call to make, or the refusal to show (on a field when one is named). */
export type StatusStep =
  { ok: true; input: CompanyStatusInput } | { ok: false; field: StatusField | null; message: string };

/**
 * The action to send, checked first by the shared `statusActionInputProblem` with `expectedStatus`
 * the preview's stored status, so a refusal the rules can see never asks for a code (criterion 91).
 * The reason goes trimmed; the typed name goes as typed, for cancel only.
 */
export function statusStep(
  action: CompanyStatusAction,
  draft: StatusDraft,
  expectedStatus: string,
  companyName: string,
): StatusStep {
  const input: CompanyStatusInput = { action, reason: draft.reason.trim(), expectedStatus };
  if (action === "cancel") input.confirmName = draft.confirmName;
  const problem = statusActionInputProblem(action, input, companyName);
  if (!problem) return { ok: true, input };
  const field: StatusField | null =
    problem === ADMIN_REASON_MESSAGE ? "reason" : problem === STATUS_ACTION_MESSAGES.confirmName ? "confirmName" : null;
  return { ok: false, field, message: problem };
}

/** The toast after each action (spec "The status dialog", Success). */
export function statusDoneText(action: CompanyStatusAction, name: string): string {
  switch (action) {
    case "suspend":
      return `${name} is suspended.`;
    case "reinstate":
      return `${name} is reinstated.`;
    case "cancel":
      return `${name} is cancelled. Nothing was deleted.`;
  }
}

/**
 * Whether a failure closes the dialog and reads the status again: a 409 `conflict` or a 422
 * `rule_broken`, in api mode or the demo, means the company's state isn't what the preview showed
 * (another admin may have acted). It is decided on the code, never the text. Any other failure
 * brings the form back with what was typed.
 */
export function refusalClosesDialog(failure: unknown): boolean {
  const code = apiErrorCode(failure);
  return code === "conflict" || code === "rule_broken";
}
