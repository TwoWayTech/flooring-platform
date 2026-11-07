# ADR 0002: Vendored shadcn/ui primitives

Date: 2026-11-07. Status: accepted.

## Context
CLAUDE.md rule 14 asks for a JSDoc comment on every exported function, component, hook and type, and also forbids comments that only repeat the code. The shadcn/ui CLI copies about twenty primitive files (button, dialog, select, command and so on) into `packages/ui/src/components`, with roughly a hundred small exports such as `DialogHeader` or `SelectItem`.

## Decision
- The shadcn primitives are treated as vendored code. Each file carries a header naming its source and pointing here; individual exports do not get one-line JSDoc that would only restate their names.
- Changes we make to them are limited to styling through the design tokens (radius hierarchy, panel radius on floating menus) and import paths.
- Everything we write ourselves, including the design-system components (`FloorPattern`, `RollGauge`, `Num`, `StatusPill`, `BrandStyle`, `Panel`, `PageHeader`, `Monogram`, `Swatch`, `EmptyState`), follows rule 14 in full.

## Also recorded
- The shadcn CLI added an unrelated npm package named `cn` to `apps/web` and imported `cn` from it. Both were reverted; the components import `cn` from `@workspace/ui/lib/utils`.
- The login floor pattern animates with CSS keyframes rather than Motion: several hundred planks animate more smoothly on the compositor. Motion remains the library for interaction motion (spec section 1).
