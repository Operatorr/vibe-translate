import type { Route as RootRoute } from './routes/__root'
import type { Route as AppRoute } from './routes/app/route'

type FileRouteMap = {
  '/': {
    id: '/'
    path: '/'
    fullPath: '/'
    parentRoute: typeof RootRoute
  }
  '/pricing': {
    id: '/pricing'
    path: '/pricing'
    fullPath: '/pricing'
    parentRoute: typeof RootRoute
  }
  '/auth': {
    id: '/auth'
    path: '/auth'
    fullPath: '/auth'
    parentRoute: typeof RootRoute
  }
  '/legal': {
    id: '/legal'
    path: '/legal'
    fullPath: '/legal'
    parentRoute: typeof RootRoute
  }
  '/changelog': {
    id: '/changelog'
    path: '/changelog'
    fullPath: '/changelog'
    parentRoute: typeof RootRoute
  }
  '/invite': {
    id: '/invite'
    path: '/invite'
    fullPath: '/invite'
    parentRoute: typeof RootRoute
  }
  '/dev/diagnostics': {
    id: '/dev/diagnostics'
    path: '/dev/diagnostics'
    fullPath: '/dev/diagnostics'
    parentRoute: typeof RootRoute
  }
  '/app': {
    id: '/app'
    path: '/app'
    fullPath: '/app'
    parentRoute: typeof RootRoute
  }
  '/app/': {
    id: '/app/'
    path: '/'
    fullPath: '/app/'
    parentRoute: typeof AppRoute
  }
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': FileRouteMap['/']
    '/pricing': FileRouteMap['/pricing']
    '/auth': FileRouteMap['/auth']
    '/legal': FileRouteMap['/legal']
    '/changelog': FileRouteMap['/changelog']
    '/invite': FileRouteMap['/invite']
    '/dev/diagnostics': FileRouteMap['/dev/diagnostics']
    '/app': FileRouteMap['/app']
    '/app/': FileRouteMap['/app/']
  }
}

declare module '@tanstack/router-core' {
  interface FileRoutesByPath {
    '/': FileRouteMap['/']
    '/pricing': FileRouteMap['/pricing']
    '/auth': FileRouteMap['/auth']
    '/legal': FileRouteMap['/legal']
    '/changelog': FileRouteMap['/changelog']
    '/invite': FileRouteMap['/invite']
    '/dev/diagnostics': FileRouteMap['/dev/diagnostics']
    '/app': FileRouteMap['/app']
    '/app/': FileRouteMap['/app/']
  }
}
