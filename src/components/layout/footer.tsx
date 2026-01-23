import { ExternalLink } from 'lucide-react'

export function Footer() {
  return (
    <footer className="border-t border-slate-200/60 bg-white/50 py-6 dark:border-slate-700/50 dark:bg-slate-900/50">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Powered by{' '}
          <a
            href="https://moonlet.io"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            Moonlet
          </a>
        </p>
        <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
          <span>Tempo Testnet (Moderato) · chainId 42431</span>
          <a
            href="https://explore.tempo.xyz"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            Explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </footer>
  )
}
