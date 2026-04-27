'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'

type Size = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[min(96vw,1400px)]',
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  size?: Size
  footer?: ReactNode
  children: ReactNode
  /*
   * If true, clicking the backdrop closes the modal. Default true. Set false
   * for forms with unsaved input where accidental dismissal is dangerous.
   */
  dismissOnBackdrop?: boolean
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  dismissOnBackdrop = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<Element | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement
    const dialog = dialogRef.current
    if (!dialog) return

    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
    const first = focusables[0]
    if (first) first.focus()
    else dialog.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
      const prev = previousFocusRef.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [open])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!dismissOnBackdrop) return
      if (e.target === e.currentTarget) onClose()
    },
    [dismissOnBackdrop, onClose],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/50 px-4 py-10"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full rounded-lg bg-white shadow-card-lg outline-none',
          SIZE[size],
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-6 py-4">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="font-serif text-lg leading-tight text-neutral-900">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-neutral-500">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50/50 px-6 py-3 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
