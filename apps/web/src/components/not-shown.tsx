/**
 * A dash in place of a figure the answer left out because the viewer may not see it (CLAUDE.md
 * rule 5: the server strips it). Screen readers hear "Not shown" rather than a bare dash.
 */
export function NotShown() {
  return (
    <span className="text-muted-foreground" aria-label="Not shown">
      —
    </span>
  );
}
