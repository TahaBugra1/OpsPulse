import * as React from "react"

import { cn } from "@/lib/utils"

// Page/section title row. No margin of its own — the consumer (AppShell
// header bar, or the first child of a gap-* page wrapper) controls spacing.
function PageHeader({
  title,
  actions,
  className,
}: {
  title: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex items-center justify-between gap-4", className)}
    >
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export { PageHeader }
