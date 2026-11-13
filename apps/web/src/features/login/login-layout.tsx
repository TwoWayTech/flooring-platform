import type { ReactNode } from "react";
import type { FloorPattern as FloorPatternKind } from "@workspace/shared";
import { BrandStyle } from "@workspace/ui/components/brand-style";
import { FloorPattern } from "@workspace/ui/components/floor-pattern";

interface LoginLayoutProps {
  brandColor: string;
  pattern: FloorPatternKind;
  /** The product's name, shown as the wordmark. */
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}

/**
 * The sign-in page frame shared by the demo and the real login: the brand's floor pattern lays
 * itself behind the panel (the product's one decorative motion, design brief), with the product's
 * wordmark on top. On a phone the panel docks to the bottom.
 */
export function LoginLayout({ brandColor, pattern, title, subtitle, children }: LoginLayoutProps) {
  return (
    <div className="bg-background relative min-h-dvh overflow-hidden">
      <BrandStyle color={brandColor} />
      <FloorPattern key={pattern} pattern={pattern} animate className="absolute inset-0 size-full" />
      <div className="relative flex min-h-dvh flex-col pt-28 sm:p-6 sm:pt-6 lg:p-12">
        <main className="bg-surface border-hairline sm:rounded-dialog flex w-full flex-1 flex-col gap-7 rounded-t-dialog border p-6 shadow-lg sm:max-w-[480px] sm:flex-none sm:p-8">
          <header className="flex flex-col gap-1">
            <p className="font-display text-2xl font-semibold tracking-[-0.01em]">{title}</p>
            <p className="text-muted-foreground">{subtitle}</p>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
