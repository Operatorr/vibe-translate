export const publicRoutes = ['/', '/pricing', '/auth', '/legal', '/changelog', '/invite'] as const

export function isPublicRoute(pathname: string) {
  return publicRoutes.includes(pathname as (typeof publicRoutes)[number])
}
