import { useQueryClient } from '@tanstack/react-query'
import { Activity, Bell, ClipboardList, Inbox, LayoutDashboard, LogOut, User, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'
import { useSocket } from '@/context/SocketContext'
import { ROLE_LABELS } from '@/lib/users'
import { cn } from '@/lib/utils'
import {
  type AppNotification,
  useMarkAllAsRead,
  useMarkAsRead,
  useNotifications,
  useUnreadCount,
} from '@/lib/notifications'

const NAV_ITEMS_BY_ROLE: Record<string, { to: string; label: string; icon: LucideIcon }[]> = {
  EMPLOYEE: [
    { to: '/analytics', label: 'Genel Bakış', icon: LayoutDashboard },
    { to: '/requests', label: 'Talepler', icon: ClipboardList },
  ],
  DEPARTMENT_AUTHORITY: [
    { to: '/analytics', label: 'Genel Bakış', icon: LayoutDashboard },
    { to: '/queue', label: 'Kuyruk', icon: Inbox },
    { to: '/requests', label: 'Talepler', icon: ClipboardList },
  ],
  ADMIN: [
    { to: '/analytics', label: 'Genel Bakış', icon: LayoutDashboard },
    { to: '/requests', label: 'Talepler', icon: ClipboardList },
    { to: '/queue', label: 'Kuyruk', icon: Inbox },
    { to: '/admin/users', label: 'Kullanıcılar', icon: Users },
  ],
}

// ADMIN's role definition includes "system-wide dashboard" (CLAUDE.md), so
// they land on the analytics overview; every other role still lands on
// their request list — the operational entry point for their actual work.
export function getLandingPath(role: string): string {
  return role === 'ADMIN' ? '/analytics' : '/requests'
}

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const socket = useSocket()
  const navItems = user ? (NAV_ITEMS_BY_ROLE[user.role] ?? []) : []
  const initials = user ? `${user.name.charAt(0)}${user.surname?.charAt(0) ?? ''}`.toUpperCase() : ''

  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const unreadCountQuery = useUnreadCount()
  const notificationsQuery = useNotifications(notificationsOpen)
  const markAsReadMutation = useMarkAsRead()
  const markAllAsReadMutation = useMarkAllAsRead()
  const unreadCount = unreadCountQuery.data?.count

  function invalidateNotifications() {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  function handleNotificationClick(notification: AppNotification) {
    markAsReadMutation.mutate(notification.id, { onSuccess: invalidateNotifications })
    setNotificationsOpen(false)
    if (notification.request_id) {
      navigate(`/requests/${notification.request_id}`)
    }
  }

  function handleMarkAllAsRead() {
    markAllAsReadMutation.mutate(undefined, { onSuccess: invalidateNotifications })
  }

  // Live updates: increment the unread badge directly on
  // `notification:created` instead of refetching — the dropdown's own GET
  // (fetched only while open) stays a separate, unrelated query.
  useEffect(() => {
    if (!socket) return

    function handleNotificationCreated() {
      queryClient.setQueryData(['notifications', 'unread-count'], (old: { count: number } | undefined) =>
        old ? { count: old.count + 1 } : old,
      )
    }

    socket.on('notification:created', handleNotificationCreated)

    return () => {
      socket.off('notification:created', handleNotificationCreated)
    }
  }, [socket, queryClient])

  return (
    <div className="flex h-svh bg-background">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-4">
        <div>
          <div className="mb-5 flex items-center gap-2 px-3 py-2">
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
                      'relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-foreground'
                        : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1 left-0 w-1.5 rounded-full bg-sidebar-primary"
                        />
                      )}
                      <Icon className={cn('size-4', isActive && 'text-sidebar-primary')} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          <DropdownMenu onOpenChange={setNotificationsOpen}>
            <DropdownMenuTrigger
              className="relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-popup-open:bg-sidebar-accent"
            >
              <span className="relative inline-flex">
                <Bell className="size-4" />
                {!!unreadCount && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-medium text-sidebar-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </span>
              Bildirimler
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-80">
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="text-xs font-medium text-muted-foreground">Bildirimler</span>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={handleMarkAllAsRead}
                >
                  Tümünü Okundu İşaretle
                </button>
              </div>
              <DropdownMenuSeparator />
              {notificationsQuery.data && notificationsQuery.data.length === 0 && (
                <div className="px-1.5 py-2 text-sm text-muted-foreground">Bildirim yok</div>
              )}
              {notificationsQuery.data?.map((notification) => (
                <DropdownMenuItem key={notification.id} onClick={() => handleNotificationClick(notification)}>
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-normal">{notification.message}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(notification.created_at).toLocaleString('tr-TR')}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator className="bg-sidebar-border" />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left outline-none hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
            >
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
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="size-4" />
                Profilim
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={logout}>
                <LogOut className="size-4" />
                Çıkış Yap
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 overflow-auto px-8 py-6">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}