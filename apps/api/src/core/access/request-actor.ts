import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import type { z } from "zod";
import type { AuthSession } from "../auth/session.service";
import type { RequestAccess } from "./access.service";
import type { AuditActor } from "./audit";

/** Who acts in a module's service: their access, the session for step-up, and the request facts for audit. */
export interface Actor {
  access: RequestAccess;
  session: AuthSession;
  audit: AuditActor;
}

/** A request body checked against its schema (Zod at the boundary); 400 `invalid_request` otherwise. */
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_request",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    });
  }
  return parsed.data;
}

/** The actor of a request, from the guards' access, the verified session and the request. */
export function actorOf(access: RequestAccess, session: AuthSession, request: Request): Actor {
  return { access, session, audit: { access, ip: request.ip ?? null, userAgent: request.get("user-agent") ?? null } };
}
