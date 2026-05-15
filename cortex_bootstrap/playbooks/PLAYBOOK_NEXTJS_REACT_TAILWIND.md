# Playbook: Next.js + React + Tailwind (Cortex Bootstrap)

## Objective
Provide deterministic guidance for building maintainable Next.js applications with React and Tailwind CSS, optimized for low-memory environments and progressive delivery.

## Core Principles
1. Prefer App Router architecture (server-first by default).
2. Use small, composable components with clear ownership.
3. Keep business rules out of UI components.
4. Use design tokens and avoid hardcoded styling values.
5. Build incrementally with safe defaults when requirements are incomplete.

## Baseline Stack
- Next.js (App Router)
- React
- Tailwind CSS
- TypeScript when available
- CSS variables for design tokens in global styles

## Recommended Folder Model
- app/: routes, layouts, route-level composition
- components/: reusable UI components
- features/: domain-specific modules
- lib/: shared utilities and clients
- server/: data access and domain orchestration
- styles/: token sources and global style rules

## React Architecture Rules
1. Default to Server Components for data-heavy screens.
2. Use Client Components only for interactivity, local state, browser APIs.
3. Keep component props explicit and typed.
4. Avoid large "god components"; split by responsibility.
5. Keep side effects localized and predictable.

## Next.js Data and Security Rules
1. Centralize data access in a server-side data access layer.
2. Validate inputs before mutations.
3. Enforce authorization server-side for each sensitive action.
4. Never expose secrets to the client bundle.
5. Return only data needed by the UI (DTO-like response shaping).

## Tailwind + Design System Rules
1. Define tokens in global CSS variables (color, spacing, radius, elevation, typography).
2. Map Tailwind usage to tokenized values and semantic intent.
3. Avoid one-off arbitrary styles unless justified by component scope.
4. Keep visual consistency: spacing rhythm, typography scale, contrast.
5. Support dark/light strategy only when product requires it.

## Proactive Build Strategy (Before User Specifics)
When a request is ambiguous, produce a safe baseline using:
1. Standard page skeleton: header, content, utility actions, footer/help zone.
2. Domain-neutral component set: button, input, card, table/list, alert, modal.
3. Accessibility defaults: keyboard focus, labels, aria where needed.
4. Error/empty/loading states for every async block.
5. Clear extension points for future domain customization.

## Complexity Handling
For complex features, decompose into:
1. Intent and constraints
2. Data contracts
3. UI contract
4. Action handlers
5. Validation and fallback paths
6. Test checkpoints and acceptance criteria

## Delivery Checklist
- Route and component boundaries are clean
- Tokenized styles are used consistently
- No secret is exposed in client code
- Empty/loading/error states exist
- Output is production-extendable, not a throwaway scaffold
