import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'Shepherdly — Faith Church',
  description: 'Shepherding dashboard for Faith Church',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          duration={4000}
          toastOptions={{
            style: {
              fontFamily: 'var(--font-sans)',
              borderRadius: 'var(--radius-md)',
            },
          }}
        />
      </body>
    </html>
  )
}
