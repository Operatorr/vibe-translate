import type { UseMutationOptions } from '@tanstack/react-query'

// QueryClient.clear cancels queries, but cannot cancel a server mutation.
// Capture ownership at mutation start, not in a render closure that an observer
// can replace while the request is in flight.
export function scopedMutation<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  getOwner: () => string | undefined,
) {
  type Scope = { owner: string | undefined; value: TContext | undefined }
  return {
    ...options,
    onMutate: async (variables, context) => {
      const owner = getOwner()
      const value = await options.onMutate?.(variables, context)
      return { owner, value }
    },
    onSuccess: (data, variables, scope, context) => {
      if (scope?.owner === getOwner())
        return options.onSuccess?.(
          data,
          variables,
          scope?.value as TContext,
          context,
        )
    },
    onError: (error, variables, scope, context) => {
      if (scope?.owner === getOwner())
        return options.onError?.(error, variables, scope?.value, context)
    },
    onSettled: (data, error, variables, scope, context) => {
      if (scope?.owner === getOwner())
        return options.onSettled?.(
          data,
          error,
          variables,
          scope?.value,
          context,
        )
    },
  } satisfies UseMutationOptions<TData, Error, TVariables, Scope>
}
