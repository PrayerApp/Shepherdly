import { z } from 'zod'

/*
 * PCO speaks JSON:API: every resource is wrapped in `{ id, type, attributes,
 * relationships }`. List responses include `data` (an array), `links` (with
 * an optional `next`), `meta`, and `included` (sideloaded resources).
 *
 * These are the generic envelopes — per-resource attribute shapes live in
 * ./schemas. We keep them permissive on `included` and `meta` so that
 * unfamiliar fields from PCO don't fail validation; the strictness is at the
 * `attributes` level where we actually read fields.
 */

const RelationshipRef = z.object({
  id: z.string(),
  type: z.string(),
})

const Relationship = z.object({
  data: z.union([RelationshipRef, z.array(RelationshipRef), z.null()]).optional(),
})

export const Relationships = z.record(z.string(), Relationship).optional()

export function jsonApiResource<A extends z.ZodTypeAny>(attributes: A) {
  return z.object({
    id: z.string(),
    type: z.string(),
    attributes,
    relationships: Relationships,
    links: z.record(z.string(), z.string()).optional(),
  })
}

export function jsonApiSingle<A extends z.ZodTypeAny>(attributes: A) {
  return z.object({
    data: jsonApiResource(attributes),
    included: z.array(z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
}

export function jsonApiList<A extends z.ZodTypeAny>(attributes: A) {
  return z.object({
    data: z.array(jsonApiResource(attributes)),
    links: z.object({
      self: z.string().optional(),
      next: z.string().optional(),
      prev: z.string().optional(),
    }).partial().optional(),
    meta: z.object({
      total_count: z.number().optional(),
      count: z.number().optional(),
      next: z.object({ offset: z.number().optional() }).partial().optional(),
    }).partial().optional(),
    included: z.array(z.unknown()).optional(),
  })
}

export type JsonApiResource<A> = {
  id: string
  type: string
  attributes: A
  relationships?: Record<string, { data?: { id: string; type: string } | { id: string; type: string }[] | null }>
  links?: Record<string, string>
}

export type JsonApiList<A> = {
  data: JsonApiResource<A>[]
  links?: { self?: string; next?: string; prev?: string }
  meta?: {
    total_count?: number
    count?: number
    next?: { offset?: number }
  }
  included?: unknown[]
}

/*
 * Read a to-one relationship id. PCO sometimes returns `null` data, sometimes
 * omits the relationship entirely — both mean "no link."
 */
export function readToOne(
  resource: JsonApiResource<unknown>,
  rel: string,
): string | null {
  const data = resource.relationships?.[rel]?.data
  if (!data || Array.isArray(data)) return null
  return data.id
}

/*
 * Read a to-many relationship id list. Missing or null is an empty list.
 */
export function readToMany(
  resource: JsonApiResource<unknown>,
  rel: string,
): string[] {
  const data = resource.relationships?.[rel]?.data
  if (!data || !Array.isArray(data)) return []
  return data.map(d => d.id)
}
