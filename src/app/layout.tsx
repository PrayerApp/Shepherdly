import type { Metadata } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

/*
 * Self-hosted via next/font:
 *   - Inter for body / UI. Tabular numerals + slashed-zero variants
 *     (ss01/cv11) for cleaner stats columns.
 *   - Fraunces for headings. Variable weight + optical-size axis;
 *     the warm, pastoral feel suits a shepherding product better
 *     than Georgia's neutral newspaper voice.
 *
 * Both are exposed as CSS variables so globals.css can wire them
 * into the existing @theme tokens.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
})

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  weight: 'variable',
  axes: ['SOFT', 'opsz'],
})

export const metadata: Metadata = {
  title: 'Shepherdly — Faith Church',
  description: 'Shepherding dashboard for Faith Church',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
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
