import { z } from 'zod';

const namespacePrefixSchema = z
  .string()
  .trim()
  .min(1, 'Prefix must contain at least one character')
  .max(128, 'Prefix exceeds 128 characters')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/,
    'Prefix may include alphanumeric, colon, underscore, and dash characters'
  );

const listQuerySchema = z.object({
  prefix: namespacePrefixSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});

export type NamespaceListQuery = z.infer<typeof listQuerySchema>;

export function parseNamespaceListQuery(params: unknown): NamespaceListQuery {
  return listQuerySchema.parse(params ?? {});
}
