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
 * The desktop / mobile decision is driven by a JS media query rather
 * than Tailwind's `hidden md:flex` utilities. The previous version
 * was reportedly leaving the sidebar visible on mobile devices; doing
 * the split in JS removes any ambiguity from Tailwind class generation
 * or purge behavior. SSR safety: we initialize as desktop=true so the
 * server render matches the most common client (desktop) and avoids
 * a hamburger flash on hydration; the effect corrects it on mount.
 *
 * Page titles come from a route → label map.
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
  { prefix: '/handoffs', label: 'Handoffs' },
  { prefix: '/settings/users', label: 'Manage Users' },
  { prefix: '/settings/pco', label: 'PCO Connection' },
  { prefix: '/settings/group-types', label: 'Group Types' },
  { prefix: '/settings/service-types', label: 'Service Types' },
]

function pageTitleFor(pathname: string): string {
  const match = ROUTE_LABELS.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  return match?.label ?? 'Shepherdly'
}

const DESKTOP_MEDIA = '(min-width: 768px)'

export function DashboardShell({
  user,
  children,
}: {
  user: User
  children: ReactNode
}) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MEDIA)
    setIsDesktop(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Close the drawer whenever the route changes — tapping a nav item
  // would otherwise leave it stuck open. Also close it whenever we
  // cross the breakpoint to desktop.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname, isDesktop])

  // ESC closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Body scroll lock while the drawer is open.
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
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Desktop persistent sidebar */}
      {isDesktop && <Sidebar user={user} />}

      {/* Mobile drawer */}
      {!isDesktop && drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(17, 24, 39, 0.5)' }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 left-0 z-50 flex">
            <Sidebar user={user} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute -right-12 top-3 rounded-md p-2 text-white"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — only when not on desktop */}
        {!isDesktop && (
          <header
            className="flex h-14 items-center gap-3 border-b px-4"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-md p-2"
              style={{ color: 'var(--foreground)' }}
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <h1 className="font-serif text-lg leading-none" style={{ color: 'var(--foreground)' }}>
              {title}
            </h1>
          </header>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
