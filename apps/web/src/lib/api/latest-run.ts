/**
 * Tickets for overlapping reads of one query, so only the newest applies its answer (ADR 0051
 * "Part 3"). Each call of the returned function hands out a ticket, and a ticket's check is true
 * only while no newer ticket has been handed out. A read that started before a newer one and
 * answers after it is then dropped, so a slow first read can't overwrite what a later one showed.
 */
export function latestRun(): () => () => boolean {
  let newest = 0;
  return () => {
    const mine = ++newest;
    return () => mine === newest;
  };
}
