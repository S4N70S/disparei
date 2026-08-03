import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Disparei — Outbound',
  description: 'Plataforma de prospecção ativa por e-mail',
}

const NAV = [
  { href: '/', label: 'Painel' },
  { href: '/campanhas', label: 'Campanhas' },
  { href: '/contatos', label: 'Contatos' },
  { href: '/respostas', label: 'Respostas' },
  { href: '/configuracoes', label: 'Configurações' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="mx-auto max-w-6xl px-4 py-6">
          <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--color-border)] pb-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Disparei
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  )
}
