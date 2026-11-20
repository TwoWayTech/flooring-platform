import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewerHoursNotice } from "@/features/my/newer-hours-notice";

const HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The notice as My timesheet shows it, for newer hours of 7.5 on Monday and 6 on Tuesday. */
function notice(busy: boolean): string {
  return renderToStaticMarkup(
    <NewerHoursNotice
      days={[7.5, 6, 0, 0, 0, 0, 0]}
      headings={HEADINGS}
      busy={busy}
      onUse={() => undefined}
      onKeep={() => undefined}
      firstButton={null}
    />,
  );
}

/** For each button in the markup, whether it is disabled. */
const disabled = (html: string) => html.match(/<button[^>]*>/g)?.map((tag) => /\sdisabled=""/.test(tag));

/** The markup's text without tags, with the spaces between elements kept. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the newer-hours notice on My timesheet (employee-portal.md Weekly hours; ADR 0051, 2026-11-16)", () => {
  it("says newer hours were saved, shows each saved day under its heading, and offers both choices", () => {
    const html = notice(false);
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("Newer hours were saved for this week.");
    expect(text(html)).toContain("Mon 7.50 Tue 6.00 Wed 0.00");
    expect(text(html)).toContain("Use saved hours drops your changes.");
    expect(disabled(html)).toEqual([false, false]);
    expect(text(html)).toMatch(/Use saved hours Keep my hours$/);
  });

  it("offers neither choice while a save or submit runs", () => {
    expect(disabled(notice(true))).toEqual([true, true]);
  });
});
