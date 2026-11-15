import { z } from "zod";

/** Why a company id in a /platform query or body is refused (spec "Validations and messages (part 3)"). */
export const COMPANY_ID_MESSAGE = "That company id is not valid.";

/**
 * A company id sent in a /platform query or body: a UUID, else 400 with the spec's message. A
 * repeated query parameter arrives as a list and is refused the same way.
 */
export const COMPANY_ID = z.string({ error: COMPANY_ID_MESSAGE }).uuid(COMPANY_ID_MESSAGE);
