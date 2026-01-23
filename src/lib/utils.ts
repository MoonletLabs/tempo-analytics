import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTs(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

export function short(s: string) {
  if (!s) return ''
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

export function toNumber(v: string): number {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export function formatDelta(current: number, previous: number, suffix = ''): string {
  const delta = current - previous
  const sign = delta > 0 ? '+' : ''
  const value = Math.abs(delta) >= 1000 ? delta.toFixed(0) : delta.toFixed(2)
  return `${sign}${value}${suffix}`
}

export function formatDeltaPct(current: number, previous: number): string {
  const delta = current - previous
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function tokenIconUrl(token: { address: string; logoURI?: string }): string {
  return `/token-icons/${token.address.toLowerCase()}.svg`
}
