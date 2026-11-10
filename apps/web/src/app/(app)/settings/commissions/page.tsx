import { redirect } from "next/navigation";

/** Commission rules moved to HR (spec C1); old links land there. */
export default function Page() {
  redirect("/hr/commissions");
}
