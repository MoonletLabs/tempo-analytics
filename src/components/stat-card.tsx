import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  delta?: string
  deltaType?: 'positive' | 'negative' | 'neutral'
  icon?: LucideIcon
  className?: string
}

export function StatCard({
  title,
  value,
  subtitle,
  delta,
  deltaType = 'neutral',
  icon: Icon,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {title}
          </h3>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {value}
          </p>
          {(subtitle || delta) && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              {subtitle && (
                <span className="text-slate-500 dark:text-slate-400">
                  {subtitle}
                </span>
              )}
              {delta && (
                <span
                  className={cn(
                    'font-medium',
                    deltaType === 'positive' && 'text-emerald-600 dark:text-emerald-400',
                    deltaType === 'negative' && 'text-rose-600 dark:text-rose-400',
                    deltaType === 'neutral' && 'text-primary-600 dark:text-primary-400'
                  )}
                >
                  {delta}
                </span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
            <Icon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </div>
        )}
      </div>
    </Card>
  )
}
