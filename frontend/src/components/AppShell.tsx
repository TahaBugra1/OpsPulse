import { NavLink, Outlet } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'

const NAV_ITEMS_BY_ROLE: Record<string, { to: string; label: string }[]> = {
  EMPLOYEE: [
    { to: '/requests', label: 'Talepler' },
  ],
  DEPARTMENT_AUTHORITY: [
    { to: '/queue', label: 'Kuyruk' },
    { to: '/requests', label: 'Talepler' },
  ],
  ADMIN: [
    { to: '/requests', label: 'Talepler' },
    { to: '/queue', label: 'Kuyruk' },
    { to: '/admin/users', label: 'Kullanıcılar' },
  ],
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

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r p-4">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col gap-3">
          <Separator />
          <p className="px-3 text-sm text-muted-foreground">
            {user?.name} {user?.surname ?? ''} ({user?.role})
          </p>
          <Button type="button" variant="outline" onClick={logout}>
            Çıkış Yap
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}