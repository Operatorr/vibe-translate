import { createContext, useContext } from 'react'

export const CacheReadyContext = createContext(false)
export const useCacheReady = () => useContext(CacheReadyContext)
