import { cn, tokenIconUrl } from '@/lib/utils'

interface TokenBadgeProps {
  token: { address: string; symbol: string; logoURI?: string }
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function TokenBadge({ token, className, size = 'md' }: TokenBadgeProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img
        className={cn(
          'rounded-full bg-slate-100 dark:bg-slate-700',
          sizeClasses[size]
        )}
        src={tokenIconUrl(token)}
        alt=""
        onError={(e) => {
          if (!token.logoURI) return
          const img = e.currentTarget
          if (img.dataset.fallback === '1') return
          img.dataset.fallback = '1'
          img.src = token.logoURI
        }}
      />
      <span className="font-medium text-slate-900 dark:text-white">
        {token.symbol}
      </span>
    </span>
  )
}
