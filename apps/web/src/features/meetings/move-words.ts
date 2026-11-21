import type { MoveKind } from "@workspace/shared";

/** The words a move or a resize shows in its dialog and toasts. */
export interface MoveWords {
  dialogTitle: string;
  /** "<title> repeats. Which events move?" */
  question: (title: string) => string;
  /** When no scope may be chosen for this drop. */
  noneOpen: (title: string) => string;
  scopeLabel: string;
  refusedLabel: string;
  confirm: string;
  done: (title: string, durationMin: number) => string;
  failed: string;
  undone: string;
  undoFailed: string;
}

const MOVE: MoveWords = {
  dialogTitle: "Move a repeating meeting",
  question: (title) => `${title} repeats. Which events move?`,
  noneOpen: (title) => `${title} repeats, and no events can move to that time.`,
  scopeLabel: "Which events move",
  refusedLabel: "Not available for this move",
  confirm: "Move",
  done: (title) => `${title} moved`,
  failed: "The meeting was not moved.",
  undone: "Move undone",
  undoFailed: "The move was not undone.",
};

const RESIZE: MoveWords = {
  dialogTitle: "Change a repeating meeting's length",
  question: (title) => `${title} repeats. Which events change length?`,
  noneOpen: (title) => `${title} repeats, and no events can change to that length.`,
  scopeLabel: "Which events change length",
  refusedLabel: "Not available for this change",
  confirm: "Change length",
  done: (title, durationMin) => `${title} now lasts ${durationMin} minutes`,
  failed: "The meeting's length was not changed.",
  undone: "Length change undone",
  undoFailed: "The length change was not undone.",
};

/**
 * The words for a change by its kind (`moveKind`; click-through #44): a resize says it changes the
 * length, so the dialog, the toast and the audit log all name what really happened.
 */
export function moveWords(kind: MoveKind): MoveWords {
  return kind === "resize" ? RESIZE : MOVE;
}

/** How long a move's toast, and the Undo it offers, stays on screen: long enough to reach for it (#44). */
export const UNDO_TOAST_MS = 10_000;
