"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketDependencyGraphJsonSchema = exports.buildTicketIndexJsonSchema = exports.buildTicketUpdateJsonSchema = exports.buildNewTicketJsonSchema = exports.buildTicketJsonSchema = exports.ticketDependencyGraphSchema = exports.ticketIndexSchema = exports.ticketIndexEntrySchema = exports.ticketUpdateSchema = exports.newTicketInputSchema = exports.ticketSchema = exports.ticketActivitySchema = exports.ticketActivityActionSchema = exports.ticketLinkSchema = exports.ticketPrioritySchema = exports.ticketStatusSchema = exports.ticketIdSchema = void 0;
var zod_1 = require("zod");
var zod_to_json_schema_1 = require("zod-to-json-schema");
exports.ticketIdSchema = zod_1.z
    .string()
    .min(3, 'Ticket id must be at least 3 characters long')
    .max(120, 'Ticket id must be at most 120 characters long')
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Ticket id must start with an alphanumeric character and contain only alphanumerics, dot, underscore, or dash');
exports.ticketStatusSchema = zod_1.z.enum([
    'backlog',
    'in_progress',
    'blocked',
    'review',
    'done',
    'archived'
]);
exports.ticketPrioritySchema = zod_1.z.enum(['low', 'medium', 'high', 'critical']);
exports.ticketLinkSchema = zod_1.z.object({
    label: zod_1.z.string().min(1),
    url: zod_1.z.string().url(),
    kind: zod_1.z.enum(['doc', 'issue', 'pr', 'design', 'spec', 'other']).default('other').optional(),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional()
});
exports.ticketActivityActionSchema = zod_1.z.enum([
    'created',
    'updated',
    'status.change',
    'comment',
    'dependency.change',
    'assignment',
    'field.change'
]);
exports.ticketActivitySchema = zod_1.z.object({
    id: zod_1.z.string().min(8),
    actor: zod_1.z.string().min(1),
    action: exports.ticketActivityActionSchema,
    at: zod_1.z.string().datetime({ message: 'Activity timestamp must be ISO-8601' }),
    message: zod_1.z.string().optional(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional()
});
exports.ticketSchema = zod_1.z.object({
    id: exports.ticketIdSchema,
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().min(1),
    status: exports.ticketStatusSchema,
    priority: exports.ticketPrioritySchema.default('medium'),
    assignees: zod_1.z.array(zod_1.z.string()).default([]),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    dependencies: zod_1.z.array(exports.ticketIdSchema).default([]),
    dependents: zod_1.z.array(exports.ticketIdSchema).default([]),
    createdAt: zod_1.z
        .string()
        .datetime({ message: 'createdAt must be an ISO-8601 timestamp' }),
    updatedAt: zod_1.z
        .string()
        .datetime({ message: 'updatedAt must be an ISO-8601 timestamp' }),
    dueAt: zod_1.z.string().datetime({ message: 'dueAt must be an ISO-8601 timestamp' }).optional(),
    history: zod_1.z.array(exports.ticketActivitySchema).default([]),
    links: zod_1.z.array(exports.ticketLinkSchema).default([]),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    fields: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    revision: zod_1.z.number().int().min(1)
});
exports.newTicketInputSchema = zod_1.z.object({
    id: exports.ticketIdSchema.optional(),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().min(1),
    status: exports.ticketStatusSchema.default('backlog'),
    priority: exports.ticketPrioritySchema.default('medium'),
    assignees: zod_1.z.array(zod_1.z.string()).default([]),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    dependencies: zod_1.z.array(exports.ticketIdSchema).default([]),
    dueAt: zod_1.z.string().datetime().optional(),
    links: zod_1.z.array(exports.ticketLinkSchema).default([]),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    fields: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    history: zod_1.z.array(exports.ticketActivitySchema).default([])
});
exports.ticketUpdateSchema = exports.ticketSchema
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
    comment: zod_1.z.string().optional()
});
exports.ticketIndexEntrySchema = zod_1.z.object({
    id: exports.ticketIdSchema,
    title: zod_1.z.string(),
    status: exports.ticketStatusSchema,
    priority: exports.ticketPrioritySchema,
    assignees: zod_1.z.array(zod_1.z.string()),
    tags: zod_1.z.array(zod_1.z.string()),
    dependencies: zod_1.z.array(exports.ticketIdSchema),
    dependents: zod_1.z.array(exports.ticketIdSchema),
    updatedAt: zod_1.z.string().datetime(),
    revision: zod_1.z.number().int().min(1)
});
exports.ticketIndexSchema = zod_1.z.object({
    generatedAt: zod_1.z.string().datetime(),
    tickets: zod_1.z.array(exports.ticketIndexEntrySchema)
});
exports.ticketDependencyGraphSchema = zod_1.z.object({
    generatedAt: zod_1.z.string().datetime(),
    nodes: zod_1.z.record(exports.ticketIdSchema, zod_1.z.object({
        dependencies: zod_1.z.array(exports.ticketIdSchema),
        dependents: zod_1.z.array(exports.ticketIdSchema)
    }))
});
var buildTicketJsonSchema = function (options) {
    var _a;
    if (options === void 0) { options = {}; }
    return (0, zod_to_json_schema_1.zodToJsonSchema)(exports.ticketSchema, { name: (_a = options.title) !== null && _a !== void 0 ? _a : 'Ticket' });
};
exports.buildTicketJsonSchema = buildTicketJsonSchema;
var buildNewTicketJsonSchema = function (options) {
    var _a;
    if (options === void 0) { options = {}; }
    return (0, zod_to_json_schema_1.zodToJsonSchema)(exports.newTicketInputSchema, { name: (_a = options.title) !== null && _a !== void 0 ? _a : 'NewTicketInput' });
};
exports.buildNewTicketJsonSchema = buildNewTicketJsonSchema;
var buildTicketUpdateJsonSchema = function (options) {
    var _a;
    if (options === void 0) { options = {}; }
    return (0, zod_to_json_schema_1.zodToJsonSchema)(exports.ticketUpdateSchema, { name: (_a = options.title) !== null && _a !== void 0 ? _a : 'TicketUpdate' });
};
exports.buildTicketUpdateJsonSchema = buildTicketUpdateJsonSchema;
var buildTicketIndexJsonSchema = function (options) {
    var _a;
    if (options === void 0) { options = {}; }
    return (0, zod_to_json_schema_1.zodToJsonSchema)(exports.ticketIndexSchema, { name: (_a = options.title) !== null && _a !== void 0 ? _a : 'TicketIndex' });
};
exports.buildTicketIndexJsonSchema = buildTicketIndexJsonSchema;
var buildTicketDependencyGraphJsonSchema = function (options) {
    var _a;
    if (options === void 0) { options = {}; }
    return (0, zod_to_json_schema_1.zodToJsonSchema)(exports.ticketDependencyGraphSchema, { name: (_a = options.title) !== null && _a !== void 0 ? _a : 'TicketDependencyGraph' });
};
exports.buildTicketDependencyGraphJsonSchema = buildTicketDependencyGraphJsonSchema;
//# sourceMappingURL=schema.js.map