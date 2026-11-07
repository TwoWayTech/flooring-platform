import { notFound } from "next/navigation";

/** Any unknown path inside the app renders the shell's not-found page instead of a bare 404. */
export default function MissingPage() {
  notFound();
}
