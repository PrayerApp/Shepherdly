import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padded = true, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-card border border-neutral-200 bg-white shadow-card',
        padded && 'p-6',
        className,
      )}
      {...rest}
    />
  )
})

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn('font-serif text-lg leading-tight text-neutral-900', className)}>
      {children}
    </h3>
  )
}

export function CardDescription({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <p className={cn('text-sm text-neutral-500', className)}>{children}</p>
}
