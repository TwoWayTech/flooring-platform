import { cn } from "@workspace/ui/lib/utils";

interface MonogramProps {
  letters: string;
  /** Uploaded logo as a data URL; replaces the generated monogram. */
  logoUrl?: string | null;
  name: string;
  className?: string;
}

/** The company logo: an uploaded image, or a generated two-letter monogram on the brand fill. */
export function Monogram({ letters, logoUrl, name, className }: MonogramProps) {
  if (logoUrl) {
    return <img src={logoUrl} alt={`${name} logo`} className={cn("size-9 rounded-md object-contain", className)} />;
  }
  return (
    <span
      role="img"
      aria-label={`${name} logo`}
      className={cn(
        "bg-brand text-brand-foreground font-display inline-grid size-9 shrink-0 place-items-center rounded-md text-xs font-semibold",
        className,
      )}
    >
      {letters}
    </span>
  );
}
