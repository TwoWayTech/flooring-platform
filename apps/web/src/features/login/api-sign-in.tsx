import type { ProductKey } from "@workspace/shared";
import { PRODUCTS } from "@/products";

/**
 * The sign-in page when the app runs against the real API. The persona picker exists only in
 * demo mode; email, password and MFA sign-in through Better Auth replaces this notice in P8
 * (docs/real-build-plan.md).
 */
export function ApiSignIn({ product }: { product: ProductKey }) {
  const config = PRODUCTS[product];
  return (
    <div className="bg-background grid min-h-dvh place-items-center p-4 sm:p-6">
      <main className="bg-surface border-hairline rounded-dialog flex w-full max-w-[480px] flex-col gap-3 border p-6 shadow-lg sm:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em]">{config.name}</h1>
        <p className="text-muted-foreground">
          Sign-in with email, password and two-step verification is not built yet. Run the app with
          NEXT_PUBLIC_DATA_SOURCE=demo to use the demo personas.
        </p>
      </main>
    </div>
  );
}
