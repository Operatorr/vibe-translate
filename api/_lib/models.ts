import type { Client } from 'pg'

// Tasks that the model registry tracks. `translate` and `explain` may be
// BYOK-overridden by users; `embed` is fixed by the platform.
export type ModelTask = 'translate' | 'explain' | 'embed'

export type ModelRow = {
  id: string
  task: ModelTask
  provider: string
  providerModelId: string
  displayName: string
  isDefault: boolean
  embeddingDimensions: number | null
  creditCostMultiplier: number
}

// Resolve the active default model for a task. BYOK routing happens upstream
// (see api/_lib/credits.ts → resolveCallTarget); this helper always returns
// the platform-side default.
export async function getDefaultModel(db: Client, task: ModelTask): Promise<ModelRow> {
  const result = await db.query<{
    id: string
    task: ModelTask
    provider: string
    provider_model_id: string
    display_name: string
    is_default: boolean
    embedding_dimensions: number | null
    credit_cost_multiplier: string
  }>(
    `select id, task, provider, provider_model_id, display_name, is_default,
            embedding_dimensions, credit_cost_multiplier
     from models
     where task = $1 and is_default = true
     limit 1`,
    [task],
  )

  const row = result.rows[0]
  if (!row) throw new Error(`No default model registered for task: ${task}`)

  return {
    id: row.id,
    task: row.task,
    provider: row.provider,
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    isDefault: row.is_default,
    embeddingDimensions: row.embedding_dimensions,
    creditCostMultiplier: Number(row.credit_cost_multiplier),
  }
}
