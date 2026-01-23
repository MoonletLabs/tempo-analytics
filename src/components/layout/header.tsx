import { cn } from '@/lib/utils'
import { Gauge, BarChart3, FileText, Hash } from 'lucide-react'

interface HeaderProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

const tabs = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'tables', label: 'Data Explorer', icon: FileText },
  { id: 'memo', label: 'Memo Explorer', icon: Hash },
]

export function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/60 bg-white/80 backdrop-blur-lg dark:border-slate-700/50 dark:bg-slate-900/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg shadow-primary-500/25">
            <Gauge className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Tempo Analytics
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Testnet (Moderato)
            </span>
          </div>
        </div>

        {/* Nav - Tab Navigation */}
        <nav className="flex items-center gap-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
              icon={tab.icon}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}

function NavLink({
  children,
  active = false,
  onClick,
  icon: Icon,
}: {
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      <span className="hidden sm:inline">{children}</span>
    </button>
  )
}
