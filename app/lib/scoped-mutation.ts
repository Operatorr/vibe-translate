import type {
  MutationFunctionContext,
  UseMutationOptions,
} from '@tanstack/react-query'

// QueryClient.clear cancels queries, but cannot cancel a server mutation.
// Capture ownership at mutation start, not in a render closure that an observer
// can replace while the request is in flight. TanStack passes one context
// object to every callback of an execution, including replaced options, so it
// keys the owner even when onMutate rejects and leaves no result.
const owners = new WeakMap<MutationFunctionContext, string | undefined>()

export function scopedMutation<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  getOwner: () => string | undefined,
): UseMutationOptions<TData, Error, TVariables, TContext> {
  const owns = (context: MutationFunctionContext) =>
    owners.has(context) && owners.get(context) === getOwner()
  return {
    ...options,
    onMutate: (variables, context) => {
      owners.set(context, getOwner())
      return options.onMutate?.(variables, context) as
        | TContext
        | Promise<TContext>
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      if (owns(context))
        return options.onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: (error, variables, onMutateResult, context) => {
      if (owns(context))
        return options.onError?.(error, variables, onMutateResult, context)
    },
    onSettled: (data, error, variables, onMutateResult, context) => {
      if (owns(context))
        return options.onSettled?.(
          data,
          error,
          variables,
          onMutateResult,
          context,
        )
    },
  }
}
