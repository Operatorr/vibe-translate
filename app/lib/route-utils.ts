export const publicRoutes = ['/', '/pricing', '/auth', '/legal', '/invite'] as const

export function isPublicRoute(pathname: string) {
  return publicRoutes.includes(pathname as (typeof publicRoutes)[number])
}
