import type { CompanyDb, DbHandle } from "@workspace/db";
import { userProfiles } from "@workspace/db/company";
import { cashAccountFor, type PaymentMethod } from "@workspace/shared";
import { inArray } from "drizzle-orm";
import { todayIn } from "./company-day";
import type { AuthHarness } from "../auth-harness";
import { BOOTSTRAP_ZONE, bootstrapCompany, type BootstrappedCompany } from "./company-bootstrap";
import { acceptInvitation, inviteProvisionedOwner } from "./fresh-owner";
import { entriesBySource, trialBalanceProblems, unbalancedEntries } from "./ledger-read";
import { refusalOf, type Call, type MoneyApi } from "./money-actions";
import {
  entryProblems,
  newMemory,
  observe,
  preconditionProblems,
  readBooks,
  reconcile,
  type Books,
  type MoneyMemory,
} from "./money-model";
import { enrolled, type EnrolledPerson } from "./sign-in";

/** The people a money run acts as. Owner, Accountant and HR are enrolled (MFA); the rest are session cookies. */
export interface MoneyActors {
  owner: EnrolledPerson;
  accountant: EnrolledPerson;
  /** HR, linked to no employee, so it may approve any pay run (separation of duties). */
  hr: EnrolledPerson;
  purchasing: string;
  /** Warehouse, placed at the first branch. */
  warehouse: string;
  /** Sales, own data scope, placed at the first branch. */
  sales: string;
}

/**
 * A refusal a random step may meet without failing (MF-6): its status, code and message must all
 * match, and it names the spec rule that makes it right.
 */
export interface AllowedRefusal {
  status: number;
  code: string;
  message: RegExp;
  rule: string;
}

/** Thrown inside a step when the API refused with an allowed refusal; the runner logs it and moves on. */
export class AllowedRefusalMet extends Error {
  constructor(readonly rule: string) {
    super(rule);
  }
}

/** How one step ended. */
export type StepEnd = "done" | "refused";

/**
 * One money run on one company: who acts, what the model remembers, the latest books, and a log of
 * every step for the failure message. Each step is followed by E1 (every entry balanced, read in
 * SQL), E2 (the trial balance) and MI-DEC on the step's answers; `checkAll` adds E3 to E12, the
 * preconditions and E14. Any failure names the seed and the steps so far, so `MONEY_SEED` replays it.
 */
export class MoneyRun {
  readonly memory: MoneyMemory = newMemory();
  readonly log: string[] = [];
  readonly counts = new Map<string, number>();
  books!: Books;
  private allowed: readonly AllowedRefusal[] = [];

  constructor(
    readonly harness: AuthHarness,
    readonly api: MoneyApi,
    readonly db: DbHandle<CompanyDb>,
    readonly companyId: string,
    readonly places: BootstrappedCompany,
    readonly actors: MoneyActors,
    readonly today: string,
    readonly seed: number,
  ) {}

  /** The Owner's session cookie: every read of the books is the Owner's. */
  get owner(): string {
    return this.actors.owner.cookie;
  }

  /** Reads the books again and notes what posted. */
  async refresh(): Promise<Books> {
    this.books = await readBooks(this.api, this.owner, this.today);
    observe(this.memory, this.books);
    return this.books;
  }

  /**
   * Notes that a document posted just now, and where its cash went when it moved cash: the bank
   * its method posts to under the settings of this moment (ADR 0040). Needed when a step both
   * confirms and voids, which the books after the step alone can't show.
   */
  posted(id: string, method: PaymentMethod | null): void {
    this.memory.posted.add(id);
    if (method && !this.memory.cashAt.has(id))
      this.memory.cashAt.set(id, cashAccountFor(this.books.accounting, method));
  }

  /** Counts one event of a kind, for the end-of-run tally (MI-1 step 7). */
  note(kind: string): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }

  /**
   * Sends a call and returns its body when the status is the expected one. A refusal the current
   * step allows throws `AllowedRefusalMet`; anything else fails the run.
   */
  async act<T>(status: number, call: Call, cookie: string): Promise<T> {
    const answer = await this.api.send(call, cookie);
    if (answer.status === status) return answer.body as T;
    const refusal = refusalOf(answer);
    const match = refusal
      ? this.allowed.find(
          (a) => a.status === answer.status && a.code === refusal.code && a.message.test(refusal.message),
        )
      : undefined;
    if (match) throw new AllowedRefusalMet(match.rule);
    return this.fail(
      `${call.verb.toUpperCase()} ${call.path} answered ${answer.status}, expected ${status}: ${JSON.stringify(answer.body)}`,
    );
  }

  /** Adds what a random step actually did to its line in the step log. */
  describe(detail: string): void {
    this.log[this.log.length - 1] = `${this.log[this.log.length - 1]}: ${detail}`;
  }

  /** Fails the run with the seed and the step log, so it can be replayed with MONEY_SEED. */
  fail(message: string): never {
    throw new Error(
      `${message}\nseed ${this.seed}; steps so far:\n${this.log.map((line, i) => `  ${i + 1}. ${line}`).join("\n")}`,
    );
  }

  /**
   * Runs one step: logs it, runs it with its allowed refusals, reads the books again and checks
   * E1, E2 and the decimals of every answer the step received.
   */
  async step(label: string, body: () => Promise<void>, allowed: readonly AllowedRefusal[] = []): Promise<StepEnd> {
    this.log.push(label);
    const issuesBefore = this.api.decimalIssues.length;
    this.allowed = allowed;
    let end: StepEnd = "done";
    try {
      await body();
    } catch (error) {
      if (!(error instanceof AllowedRefusalMet)) throw error;
      this.log[this.log.length - 1] = `${label} (refused: ${error.rule})`;
      end = "refused";
    } finally {
      this.allowed = [];
    }
    await this.refresh();
    const problems = [
      ...(await unbalancedEntries(this.db.db)).map(
        (entry) =>
          `E1: entry ${entry.event} ${entry.sourceNumber} is unbalanced or malformed (${entry.debit}/${entry.credit}, ${entry.lines} lines, ${entry.badLines} bad)`,
      ),
      ...trialBalanceProblems(this.books.trial).map((problem) => `E2: ${problem}`),
      ...this.api.decimalIssues.slice(issuesBefore).map((issue) => `MI-DEC: ${issue}`),
    ];
    if (problems.length > 0) this.fail(`After "${label}":\n${problems.join("\n")}`);
    return end;
  }

  /** E3 to E12, their preconditions and E14 on the books as they stand. */
  async checkAll(where: string): Promise<void> {
    const books = await this.refresh();
    const problems = [
      ...preconditionProblems(books).map((problem) => `precondition: ${problem}`),
      ...reconcile(books, this.memory).map((m) => `${m.id}: ledger ${m.ledger}, documents ${m.documents}`),
      ...entryProblems(await entriesBySource(this.db.db), books, this.memory).map((p) => `E14: ${p}`),
    ];
    if (problems.length > 0) this.fail(`${where}:\n${problems.join("\n")}`);
  }
}

/**
 * A money run on a company made for it: provisioned the real way (America/Chicago), bootstrapped
 * with settings and products (G2, G3), its Owner signed in through the invitation provisioning
 * should send (G4), and an Accountant, HR, Purchasing, Warehouse and Sales added; Warehouse and
 * Sales work at the Denver branch, because a roll invoice needs its seller's branch. The caller
 * closes `run.db` when done.
 */
export async function startMoneyRun(
  harness: AuthHarness,
  api: MoneyApi,
  name: string,
  seed: number,
): Promise<MoneyRun> {
  const company = await harness.provisionCompany(name);
  const places = await bootstrapCompany(harness, company.id);
  const invitation = await inviteProvisionedOwner(harness, company.id);
  await acceptInvitation(harness, invitation.token);
  const add = (role: string) => harness.addUser({ companyIds: [company.id], roles: [role] });
  const owner = await enrolled(harness, invitation.email);
  const accountant = await enrolled(harness, await add("accountant"));
  const hr = await enrolled(harness, await add("hr"));
  const emails = { purchasing: await add("purchasing"), warehouse: await add("warehouse"), sales: await add("sales") };
  const db = await harness.companyDb(company.id);
  const placed = [await harness.userIdOf(emails.warehouse), await harness.userIdOf(emails.sales)];
  await db.db.update(userProfiles).set({ branchId: places.branches[0] }).where(inArray(userProfiles.userId, placed));
  const actors: MoneyActors = {
    owner,
    accountant,
    hr,
    purchasing: await harness.signIn(emails.purchasing),
    warehouse: await harness.signIn(emails.warehouse),
    sales: await harness.signIn(emails.sales),
  };
  const run = new MoneyRun(harness, api, db, company.id, places, actors, todayIn(BOOTSTRAP_ZONE), seed);
  await run.refresh();
  return run;
}
