import type { ReactNode } from 'react'
import { Card } from './Card'
import { cn } from './cn'

/*
 * Standard shell for settings pages: header + helper + body + optional
 * footer. Replaces the per-page card + h2 + button-row pattern that
 * /settings/{users,pco,group-types,service-types} all rolled by hand.
 *
 * Header is a serif h2 to match the page chrome; helper is short body
 * text. Footer is the right-aligned action row (Save / Cancel / Test
 * Connection). Pass `as="form"` if the section is a form so the entire
 * card participates in form submission.
 */

export interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  as?: 'div' | 'form'
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
}

export function SettingsSection({
  title,
  description,
  footer,
  children,
  className,
  as = 'div',
  onSubmit,
}: SettingsSectionProps) {
  const body = (
    <>
      <header className="mb-4">
        <h2 className="font-serif text-xl leading-tight text-neutral-900">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        )}
      </header>
      <div className="space-y-4">{children}</div>
      {footer && (
        <footer className="mt-5 flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
          {footer}
        </footer>
      )}
    </>
  )
  if (as === 'form') {
    return (
      <Card className={cn('mb-6', className)}>
        <form onSubmit={onSubmit}>{body}</form>
      </Card>
    )
  }
  return <Card className={cn('mb-6', className)}>{body}</Card>
}
