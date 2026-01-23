import { z } from 'zod'

const windowSchema = z
  .string()
  .optional()
  .transform((v) => v ?? '24h')
  .refine(
    (v) => /^[0-9]+(h|d)$/.test(v),
    'window must be like 24h or 7d',
  )

export function parseWindowSeconds(raw: string | undefined): number {
  const value = windowSchema.parse(raw)
  const amount = Number.parseInt(value.slice(0, -1), 10)
  const unit = value.slice(-1)
  if (!Number.isFinite(amount) || amount <= 0) return 24 * 3600
  const seconds = unit === 'h' ? amount * 3600 : amount * 24 * 3600
  // Hard cap to 7 days for now.
  return Math.min(seconds, 7 * 24 * 3600)
}
