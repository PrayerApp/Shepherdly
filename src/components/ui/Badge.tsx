import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const TONE: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  primary: 'bg-green-100 text-green-800 ring-green-200',
  success: 'bg-green-100 text-green-800 ring-green-200',
  warning: 'bg-gold-100 text-gold-700 ring-gold-200',
  danger: 'bg-red-50 text-red-700 ring-red-100',
  info: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  children: ReactNode
}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
