import { roleRequiresMfa, type Role, type User } from "@workspace/shared";
import { PASSKEY_REFUSALS, passkeyNameProblem, type PasskeySummary, type SignInSecurity } from "@/lib/session/passkeys";
import { DemoRuleError } from "./admin-rules";

/**
 * The demo's passkeys (ADR 0060): simulated, in memory for this tab, per company and person, with
 * no browser prompt. Any password confirms, as any six digits pass the demo's code step. The rules
 * the API enforces still hold: a name of 1 to 60 characters, and a person whose roles need MFA
 * keeps at least one factor (the simulated authenticator app is `mfaEnrolled`).
 */
export class DemoPasskeys {
  private readonly byPerson = new Map<string, PasskeySummary[]>();
  private sequence = 0;

  /** Where `user` stands, with `roles` the company's roles. */
  security(key: string, user: User, roles: readonly Role[]): SignInSecurity {
    const held = roles.filter((role) => user.roleIds.includes(role.id));
    return {
      mfaRequired: held.some(roleRequiresMfa),
      totp: user.mfaEnrolled,
      passkeys: [...this.of(key)],
    };
  }

  /** The demo accepts any password that is not empty. */
  confirmPassword(password: string): void {
    if (!password) throw new DemoRuleError("Enter your password.");
  }

  add(key: string, name: string, now: string): void {
    const problem = passkeyNameProblem(name);
    if (problem) throw new DemoRuleError(problem);
    this.sequence += 1;
    this.byPerson.set(key, [
      ...this.of(key),
      { id: `demo-passkey-${this.sequence}`, name: name.trim(), createdAt: now, synced: true },
    ]);
  }

  rename(key: string, id: string, name: string): void {
    const problem = passkeyNameProblem(name);
    if (problem) throw new DemoRuleError(problem);
    this.byPerson.set(
      key,
      this.find(key, id).map((passkey) => (passkey.id === id ? { ...passkey, name: name.trim() } : passkey)),
    );
  }

  remove(key: string, id: string, security: SignInSecurity): void {
    const rest = this.find(key, id).filter((passkey) => passkey.id !== id);
    if (security.mfaRequired && !security.totp && rest.length === 0) {
      throw new DemoRuleError(PASSKEY_REFUSALS.mfa_required);
    }
    this.byPerson.set(key, rest);
  }

  private of(key: string): PasskeySummary[] {
    return this.byPerson.get(key) ?? [];
  }

  /** The person's passkeys, refusing an id that is not one of them. */
  private find(key: string, id: string): PasskeySummary[] {
    const list = this.of(key);
    if (!list.some((passkey) => passkey.id === id)) {
      throw new DemoRuleError(PASSKEY_REFUSALS.PASSKEY_NOT_FOUND);
    }
    return list;
  }
}
