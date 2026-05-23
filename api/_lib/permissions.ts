import { HTTPException } from 'hono/http-exception'

// Ownership guard. Returns 404 (not 403) on a mismatch so the API never reveals
// that a resource id exists but belongs to another user — matching the scoped
// `where id = $1 and user_id = $2` deletes/updates that already 404 uniformly.
export function assertUserOwnsResource(resourceUserId: string, currentUserId: string) {
  if (resourceUserId !== currentUserId) {
    throw new HTTPException(404, { message: 'Resource not found' })
  }
}

export function canUseFeature(enabled: boolean) {
  if (!enabled) {
    throw new HTTPException(403, { message: 'This feature is not available on your plan' })
  }
}
