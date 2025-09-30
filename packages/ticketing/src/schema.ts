import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const ticketIdSchema = z
  .string()
  .min(3, 'Ticket id must be at least 3 characters long')
  .max(120, 'Ticket id must be at most 120 characters long')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Ticket id must start with an alphanumeric character and contain only alphanumerics, dot, underscore, or dash');

export const ticketStatusSchema = z.enum([
  'backlog',
  'in_progress',
  'blocked',
  'review',
  'done',
  'archived'
]);

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const ticketLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  kind: z.enum(['doc', 'issue', 'pr', 'design', 'spec', 'other']).default('other').optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const ticketActivityActionSchema = z.enum([
  'created',
  'updated',
  'status.change',
  'comment',
  'dependency.change',
  'assignment',
  'field.change'
]);

export const ticketActivitySchema = z.object({
  id: z.string().min(8),
  actor: z.string().min(1),
  action: ticketActivityActionSchema,
  at: z.string().datetime({ message: 'Activity timestamp must be ISO-8601' }),
  message: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});

export const ticketSchema = z.object({
  id: ticketIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema.default('medium'),
  assignees: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  dependencies: z.array(ticketIdSchema).default([]),
  dependents: z.array(ticketIdSchema).default([]),
  createdAt: z
    .string()
    .datetime({ message: 'createdAt must be an ISO-8601 timestamp' }),
  updatedAt: z
    .string()
    .datetime({ message: 'updatedAt must be an ISO-8601 timestamp' }),
  dueAt: z.string().datetime({ message: 'dueAt must be an ISO-8601 timestamp' }).optional(),
  history: z.array(ticketActivitySchema).default([]),
  links: z.array(ticketLinkSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  revision: z.number().int().min(1)
});

export type Ticket = z.infer<typeof ticketSchema>;

export const newTicketInputSchema = z.object({
  id: ticketIdSchema.optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  status: ticketStatusSchema.default('backlog'),
  priority: ticketPrioritySchema.default('medium'),
  assignees: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  dependencies: z.array(ticketIdSchema).default([]),
  dueAt: z.string().datetime().optional(),
  links: z.array(ticketLinkSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  history: z.array(ticketActivitySchema).default([])
});

export type NewTicketInput = z.infer<typeof newTicketInputSchema>;

export const ticketUpdateSchema = ticketSchema
  .pick({
    title: true,
    description: true,
    status: true,
    priority: true,
    assignees: true,
    tags: true,
    dependencies: true,
    dueAt: true,
    links: true,
    metadata: true,
    fields: true
  })
  .partial()
  .extend({
    comment: z.string().optional()
  });

export type TicketUpdate = z.infer<typeof ticketUpdateSchema>;

export const ticketIndexEntrySchema = z.object({
  id: ticketIdSchema,
  title: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  assignees: z.array(z.string()),
  tags: z.array(z.string()),
  dependencies: z.array(ticketIdSchema),
  dependents: z.array(ticketIdSchema),
  updatedAt: z.string().datetime(),
  revision: z.number().int().min(1)
});

export type TicketIndexEntry = z.infer<typeof ticketIndexEntrySchema>;

export const ticketIndexSchema = z.object({
  generatedAt: z.string().datetime(),
  tickets: z.array(ticketIndexEntrySchema)
});

export type TicketIndex = z.infer<typeof ticketIndexSchema>;

export const ticketDependencyGraphSchema = z.object({
  generatedAt: z.string().datetime(),
  nodes: z.record(
    ticketIdSchema,
    z.object({
      dependencies: z.array(ticketIdSchema),
      dependents: z.array(ticketIdSchema)
    })
  )
});

export type TicketDependencyGraph = z.infer<typeof ticketDependencyGraphSchema>;

export interface SchemaExportOptions {
  title?: string;
}

export const buildTicketJsonSchema = (options: SchemaExportOptions = {}) =>
  zodToJsonSchema(ticketSchema, { name: options.title ?? 'Ticket' });

export const buildNewTicketJsonSchema = (options: SchemaExportOptions = {}) =>
  zodToJsonSchema(newTicketInputSchema, { name: options.title ?? 'NewTicketInput' });

export const buildTicketUpdateJsonSchema = (options: SchemaExportOptions = {}) =>
  zodToJsonSchema(ticketUpdateSchema, { name: options.title ?? 'TicketUpdate' });

export const buildTicketIndexJsonSchema = (options: SchemaExportOptions = {}) =>
  zodToJsonSchema(ticketIndexSchema, { name: options.title ?? 'TicketIndex' });

export const buildTicketDependencyGraphJsonSchema = (options: SchemaExportOptions = {}) =>
  zodToJsonSchema(ticketDependencyGraphSchema, { name: options.title ?? 'TicketDependencyGraph' });
