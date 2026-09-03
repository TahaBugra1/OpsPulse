import { Activity, ClipboardList, Inbox, LogOut, Users, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'

const NAV_ITEMS_BY_ROLE: Record<string, { to: string; label: string; icon: LucideIcon }[]> = {
  EMPLOYEE: [
    { to: '/requests', label: 'Talepler', icon: ClipboardList },
  ],
  DEPARTMENT_AUTHORITY: [
    { to: '/queue', label: 'Kuyruk', icon: Inbox },
    { to: '/requests', label: 'Talepler', icon: ClipboardList },
  ],
  ADMIN: [
    { to: '/requests', label: 'Talepler', icon: ClipboardList },
    { to: '/queue', label: 'Kuyruk', icon: Inbox },
    { to: '/admin/users', label: 'Kullanıcılar', icon: Users },
  ],
}

const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: 'Çalışan',
  DEPARTMENT_AUTHORITY: 'Departman Yetkilisi',
  ADMIN: 'Yönetici',
}

// DEPARTMENT_AUTHORITY's real target would be /queue, but Kuyruk is still a
// placeholder (out of scope for this task) — everyone lands on /requests
// today; this function exists so only this one return value needs to
// change later, not the route tree.
export function getLandingPath(_role: string): string {
  return '/requests'
}

export function AppShell() {
  const { user, logout } = useAuth()
  const navItems = user ? (NAV_ITEMS_BY_ROLE[user.role] ?? []) : []
  const initials = user ? `${user.name.charAt(0)}${user.surname?.charAt(0) ?? ''}`.toUpperCase() : ''

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-4">
        <div>
          <div className="mb-4 flex items-center gap-2 px-3 py-2">
            <Activity className="size-6 text-sidebar-primary" />
            <span className="text-lg font-semibold text-sidebar-foreground">OpsPulse</span>
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      isActive && 'bg-sidebar-primary text-sidebar-primary-foreground',
                    )
                  }
                >
                  <Icon className="size-4" />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          <Separator className="bg-sidebar-border" />
          <div className="flex items-center gap-3 px-3">
            <div
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-medium text-sidebar-primary-foreground"
            >
              {initials}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-sidebar-foreground">
                {user?.name} {user?.surname ?? ''}
              </span>
              <span className="truncate text-xs text-sidebar-foreground/60">
                {user ? (ROLE_LABELS[user.role] ?? user.role) : ''}
              </span>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={logout}>
            <LogOut className="size-4" />
            Çıkış Yap
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}