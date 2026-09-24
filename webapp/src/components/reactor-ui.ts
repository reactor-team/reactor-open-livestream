/**
 * Client boundary for `@reactor-team/ui`.
 *
 * The package is a single bundle that calls `useState`/`useEffect`/`useRef` but
 * ships no `"use client"` directive of its own, so importing it straight into a
 * Server Component fails the moment an interactive component renders. Marking
 * this re-export as client code gives every component a boundary and keeps the
 * pages that use them as Server Components.
 *
 * Add a component here as it is first needed rather than re-exporting the whole
 * surface - each name listed lands in the client bundle.
 */
"use client";

export { Logo } from "@reactor-team/ui";
