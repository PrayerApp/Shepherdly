'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import type { User } from '@/types'
import Sidebar from './Sidebar'

/*
 * Layout chrome for every dashboard page. Owns the mobile drawer state
 * and the responsive split between "persistent sidebar" (md+) and
 * "drawer + top bar" (<md).
 *
 * Page titles come from a route → label map. The map is local on
 * purpose: routing-time data is the right source for nav labels and
 * we want the same strings the sidebar already uses, but the sidebar
 * doesn't expose them as a public type.
 */

const ROUTE_LABELS: Array<{ prefix: string; label: string }> = [
  { prefix: '/dashboard', label: 'Dashboard' },
  { prefix: '/tree', label: 'Shepherd Tree' },
  { prefix: '/people', label: 'My Flock' },
  { prefix: '/unassigned', label: 'Unassigned' },
  { prefix: '/checkins', label: 'Check-ins' },
  { prefix: '/surveys', label: 'Surveys' },
  { prefix: '/mir', label: 'Impact Reports' },
  { prefix: '/statistics', label: 'Statistics' },
  { prefix: '/settings/users', label: 'Manage Users' },
  { prefix: '/settings/pco', label: 'PCO Connection' },
  { prefix: '/settings/group-types', label: 'Group Types' },
  { prefix: '/settings/service-types', label: 'Service Types' },
]

function pageTitleFor(pathname: string): string {
  const match = ROUTE_LABELS.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  return match?.label ?? 'Shepherdly'
}

export function DashboardShell({
  user,
  children,
}: {
  user: User
  children: ReactNode
}) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the drawer whenever the route changes — otherwise tapping a
  // nav item leaves it stuck open.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Body scroll lock while the drawer is open. Match the Modal primitive's
  // approach so behavior is consistent.
  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [drawerOpen])

  const title = pageTitleFor(pathname)

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base">
      {/* Persistent sidebar on md+. Hidden under the drawer on smaller. */}
      <div className="hidden md:flex">
        <Sidebar user={user} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-neutral-900/50 md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 left-0 z-50 flex md:hidden">
            <Sidebar user={user} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute -right-12 top-3 rounded-md bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — only on <md. Hamburger + current page title. */}
        <header className="flex h-14 items-center gap-3 border-b border-neutral-200 bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-md p-2 text-neutral-700 hover:bg-neutral-100"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <h1 className="font-serif text-lg leading-none text-neutral-900">{title}</h1>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
