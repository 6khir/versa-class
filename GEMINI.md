# 1B USD UI/UX Engineering Standard

These rules enforce modern, hyper-optimized UI/UX development practices.
Follow them to achieve an experience comparable to top-tier SaaS products (e.g. Linear, Stripe, Vercel).

## 1. Perceived Performance & Micro-Interactions
- **Optimistic UI:** Always update state instantly on user interaction while firing API calls in the background. Do not wait for server responses to update the UI.
- **Skeleton States:** Use layout-matching skeletons instead of blank page flickers or generic spinners during initial load.
- **Spring Physics:** Use Framer Motion or CSS springs (e.g., `transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)`) for buttery-smooth, tactile movement. Avoid linear animations.

## 2. Micro-Typography & Spatial Rhythm
- **Typographic Hierarchy:** Apply strict optical sizing and letter-spacing (e.g., negative tracking like `-0.02em` on headers). Prefer Inter, Geist, or equivalent.
- **Spatial Rhythm:** Stick to a strict 4px/8px modular scale for all margins, paddings, and sizing across viewports. Avoid arbitrary values like `p-3` or `p-5`.
- **Colors:** **NEVER use raw `#000` or `#fff`.** Use muted, high-contrast grays (e.g., `zinc-400` on dark mode, `zinc-900` on light mode) to soften harsh contrasts.

## 3. Keyboard-First Interaction
- **Command K Workflows:** Implement full keyboard shortcuts (e.g., `⌘K` command palettes using `cmdk`).
- **Focus Management:** Ensure instant focus management on state changes.
- **Accessibility:** Ensure all components are screen-reader accessible (WAI-ARIA compliant). Build responsive and accessible component bases (e.g., Radix UI, Shadcn).

## 4. Contextual State Preservation
- **In-place Edits:** Use inline error handling, contextual morphing animations (e.g., checkmarks morphing from loading spinners), and avoid disruptive toast notifications when possible.
- **Zero Data Loss:** Auto-save drafts into local storage automatically so zero user work is lost on accidental reload. Avoid full page reloads.

## 5. UI Layout Conventions
- Always use CSS variables for theme colors.
- Use CSS springs for modal and dropdown animations.
- Prevent layout shift by pre-reserving space for dynamic content.
