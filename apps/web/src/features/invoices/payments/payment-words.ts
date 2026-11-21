/**
 * The label of the Record payment preview's balance (click-through #14). A payment that waits for a
 * second person leaves the balance as it is until it is verified, so the preview names when the
 * figure applies instead of reading as the balance right after saving.
 */
export function balanceAfterLabel(waitsForVerification: boolean): string {
  return waitsForVerification ? "Balance after verification" : "Balance after";
}
