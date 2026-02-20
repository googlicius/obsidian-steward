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
 * Navigate to a nested field in a Zod schema using dot notation.
 * @example getNestedZodField(schema, 'validation.expectedArtifactType')
 */
function getNestedZodField(
  schema: z.ZodObject<z.ZodRawShape>,
  path: string
): z.ZodTypeAny | undefined {
  const segments = path.split('.');
  let current: z.ZodTypeAny = schema;

  for (const segment of segments) {
    const unwrapped = unwrapZodType(current);
    if (!(unwrapped instanceof z.ZodObject)) {
      return undefined;
    }
    const field = unwrapped.shape[segment];
    if (!field) {
      return undefined;
    }
    current = field;
  }

  return current;
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
 * Unwrap Zod wrapper types at the type level to get the inner shape.
 */
type UnwrapZodType<T> =
  T extends z.ZodEffects<infer Inner, unknown, unknown>
    ? UnwrapZodType<Inner>
    : T extends z.ZodOptional<infer Inner>
      ? UnwrapZodType<Inner>
      : T extends z.ZodNullable<infer Inner>
        ? UnwrapZodType<Inner>
        : T extends z.ZodDefault<infer Inner>
          ? UnwrapZodType<Inner>
          : T;

/**
 * Type helper to build paths to nested fields in a Zod schema.
 * Supports dot notation for nested object fields.
 *
 * @example
 * type Paths = NestedPaths<typeof mySchema.shape>
 * // 'validation' | 'validation.expectedArtifactType' | 'parallelToolName'
 */
type NestedPaths<T extends z.ZodRawShape, Prefix extends string = ''> = {
  [K in keyof T & string]: UnwrapZodType<T[K]> extends z.ZodObject<infer U extends z.ZodRawShape>
    ? `${Prefix}${K}` | NestedPaths<U, `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

/**
 * Build an {@link ArgMapping} record from a Zod object schema and a flag-to-field map.
 *
 * - **`field` names** are type-checked against the schema keys (including nested paths) at compile time.
 * - **`type`** is auto-derived from the Zod definition — never specified manually.
 * - Supports **nested paths** using dot notation (e.g., `'validation.expectedArtifactType'`)
 *
 * @example
 * ```ts
 * createArgMap(contentReadingSchema, {
 *   type: 'readType',       // TS error if 'readType' doesn't exist in schema
 *   blocks: 'blocksToRead', // coercion type auto-derived as 'number'
 * })
 *
 * // Nested field example:
 * createArgMap(concludeSchema, {
 *   parallel: 'parallelToolName',
 *   expectedArtifactType: 'validation.expectedArtifactType', // nested path
 * })
 * ```
 */
export function createArgMap<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  flagMap: Record<string, NestedPaths<T>>
): Record<string, ArgMapping> {
  const result: Record<string, ArgMapping> = {};

  for (const [flag, field] of Object.entries(flagMap)) {
    let zodField: z.ZodTypeAny | undefined;

    if (field.includes('.')) {
      zodField = getNestedZodField(schema, field);
    } else {
      zodField = schema.shape[field];
    }

    if (!zodField) {
      throw new Error(
        `createArgMap: field "${field}" (flag "--${flag}") not found in schema shape`
      );
    }
    result[flag] = { field, type: inferArgType(zodField) };
  }

  return result;
}
