export type RetentionWindow = {
  startsAt: Date
  endsAt: Date
}

export function getRetentionWindow(retentionDays: number, now = new Date()): RetentionWindow {
  const startsAt = new Date(now)
  startsAt.setDate(startsAt.getDate() - retentionDays)

  return {
    startsAt,
    endsAt: now,
  }
}
