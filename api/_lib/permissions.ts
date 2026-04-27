import { HTTPException } from 'hono/http-exception'

export function assertUserOwnsResource(resourceUserId: string, currentUserId: string) {
  if (resourceUserId !== currentUserId) {
    throw new HTTPException(403, { message: 'You do not have access to this resource' })
  }
}

export function canUseFeature(enabled: boolean) {
  if (!enabled) {
    throw new HTTPException(403, { message: 'This feature is not available on your plan' })
  }
}
