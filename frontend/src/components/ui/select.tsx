import * as React from "react"

import { cn } from "@/lib/utils"

// Shares the exact visual DNA of <Input> (height, radius, border, background,
// focus ring, disabled + aria-invalid treatment). Adds select-specific bits:
// appearance-none to drop the native chevron, an embedded SVG chevron on the
// right, cursor-pointer, and pr-8 to keep text clear of the chevron.
// The chevron is a static muted-grey stroke (a background-image data URI
// cannot inherit currentColor).
const SELECT_BASE =
  "h-8 w-full min-w-0 appearance-none cursor-pointer rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat"

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(SELECT_BASE, className)}
      {...props}
    >
      {props.children}
    </select>
  )
}

export { Select }
