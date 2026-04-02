import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Shepherdly — Faith Church',
  description: 'Shepherding dashboard for Faith Church',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
