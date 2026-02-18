import { z } from 'zod/v3';
import type { ArgMapping } from './commandSyntaxMappings';

/**
 * Recursively unwrap Zod wrapper types (default, optional, nullable, effects/transform)
 * to reach the underlying concrete type.
 */
function unwrapZodType(zodType: z.ZodTypeAny): z.ZodTypeAny {
  if (zodType instanceof z.ZodDefault) {
    return unwrapZodType(zodType._def.innerType);
  }
  if (zodType instanceof z.ZodOptional) {
    return unwrapZodType(zodType._def.innerType);
  }
  if (zodType instanceof z.ZodNullable) {
    return unwrapZodType(zodType._def.innerType);
  }
  if (zodType instanceof z.ZodEffects) {
    return unwrapZodType(zodType._def.schema);
  }
  return zodType;
}

/**
 * Infer the coercion type from a Zod field definition.
 *
 * Maps Zod types to the CLI coercion hints used by {@link CommandSyntaxParser}.
 */
function inferArgType(zodType: z.ZodTypeAny): ArgMapping['type'] {
  const unwrapped = unwrapZodType(zodType);

  if (unwrapped instanceof z.ZodNumber) return 'number';
  if (unwrapped instanceof z.ZodBoolean) return 'boolean';
  if (unwrapped instanceof z.ZodString || unwrapped instanceof z.ZodEnum) return 'string';
  if (unwrapped instanceof z.ZodLiteral) return 'string';

  if (unwrapped instanceof z.ZodArray) {
    const element = unwrapZodType(unwrapped.element);
    if (element instanceof z.ZodString || element instanceof z.ZodEnum) return 'string[]';
    return 'json';
  }

  if (unwrapped instanceof z.ZodObject || unwrapped instanceof z.ZodUnion) return 'json';

  return 'string';
}

/**
 * Build an {@link ArgMapping} record from a Zod object schema and a flag-to-field map.
 *
 * - **`field` names** are type-checked against the schema keys at compile time.
 * - **`type`** is auto-derived from the Zod definition — never specified manually.
 *
 * @example
 * ```ts
 * createArgMap(contentReadingSchema, {
 *   type: 'readType',       // TS error if 'readType' doesn't exist in schema
 *   blocks: 'blocksToRead', // coercion type auto-derived as 'number'
 * })
 * ```
 */
export function createArgMap<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  flagMap: Record<string, Extract<keyof T, string>>
): Record<string, ArgMapping> {
  const result: Record<string, ArgMapping> = {};

  for (const [flag, field] of Object.entries(flagMap)) {
    const zodField = schema.shape[field];
    if (!zodField) {
      throw new Error(
        `createArgMap: field "${field}" (flag "--${flag}") not found in schema shape`
      );
    }
    result[flag] = { field, type: inferArgType(zodField) };
  }

  return result;
}
