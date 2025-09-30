import { z } from 'zod';
export declare const ticketIdSchema: z.ZodString;
export declare const ticketStatusSchema: z.ZodEnum<["backlog", "in_progress", "blocked", "review", "done", "archived"]>;
export declare const ticketPrioritySchema: z.ZodEnum<["low", "medium", "high", "critical"]>;
export declare const ticketLinkSchema: z.ZodObject<{
    label: z.ZodString;
    url: z.ZodString;
    kind: z.ZodOptional<z.ZodDefault<z.ZodEnum<["doc", "issue", "pr", "design", "spec", "other"]>>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    label: string;
    url: string;
    kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    label: string;
    url: string;
    kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export declare const ticketActivityActionSchema: z.ZodEnum<["created", "updated", "status.change", "comment", "dependency.change", "assignment", "field.change"]>;
export declare const ticketActivitySchema: z.ZodObject<{
    id: z.ZodString;
    actor: z.ZodString;
    action: z.ZodEnum<["created", "updated", "status.change", "comment", "dependency.change", "assignment", "field.change"]>;
    at: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    actor: string;
    action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
    at: string;
    message?: string | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    id: string;
    actor: string;
    action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
    at: string;
    message?: string | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
export declare const ticketSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<["backlog", "in_progress", "blocked", "review", "done", "archived"]>;
    priority: z.ZodDefault<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    assignees: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dependencies: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dependents: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    dueAt: z.ZodOptional<z.ZodString>;
    history: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        actor: z.ZodString;
        action: z.ZodEnum<["created", "updated", "status.change", "comment", "dependency.change", "assignment", "field.change"]>;
        at: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }, {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }>, "many">>;
    links: z.ZodDefault<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        url: z.ZodString;
        kind: z.ZodOptional<z.ZodDefault<z.ZodEnum<["doc", "issue", "pr", "design", "spec", "other"]>>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    fields: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    revision: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
    id: string;
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "critical";
    assignees: string[];
    tags: string[];
    dependencies: string[];
    dependents: string[];
    createdAt: string;
    updatedAt: string;
    history: {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }[];
    links: {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    revision: number;
    metadata?: Record<string, unknown> | undefined;
    dueAt?: string | undefined;
    fields?: Record<string, unknown> | undefined;
}, {
    status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
    id: string;
    title: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    metadata?: Record<string, unknown> | undefined;
    priority?: "low" | "medium" | "high" | "critical" | undefined;
    assignees?: string[] | undefined;
    tags?: string[] | undefined;
    dependencies?: string[] | undefined;
    dependents?: string[] | undefined;
    dueAt?: string | undefined;
    history?: {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }[] | undefined;
    links?: {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[] | undefined;
    fields?: Record<string, unknown> | undefined;
}>;
export type Ticket = z.infer<typeof ticketSchema>;
export declare const newTicketInputSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["backlog", "in_progress", "blocked", "review", "done", "archived"]>>;
    priority: z.ZodDefault<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    assignees: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dependencies: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dueAt: z.ZodOptional<z.ZodString>;
    links: z.ZodDefault<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        url: z.ZodString;
        kind: z.ZodOptional<z.ZodDefault<z.ZodEnum<["doc", "issue", "pr", "design", "spec", "other"]>>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    fields: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    history: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        actor: z.ZodString;
        action: z.ZodEnum<["created", "updated", "status.change", "comment", "dependency.change", "assignment", "field.change"]>;
        at: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }, {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "critical";
    assignees: string[];
    tags: string[];
    dependencies: string[];
    history: {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }[];
    links: {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    metadata?: Record<string, unknown> | undefined;
    id?: string | undefined;
    dueAt?: string | undefined;
    fields?: Record<string, unknown> | undefined;
}, {
    title: string;
    description: string;
    status?: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived" | undefined;
    metadata?: Record<string, unknown> | undefined;
    id?: string | undefined;
    priority?: "low" | "medium" | "high" | "critical" | undefined;
    assignees?: string[] | undefined;
    tags?: string[] | undefined;
    dependencies?: string[] | undefined;
    dueAt?: string | undefined;
    history?: {
        id: string;
        actor: string;
        action: "created" | "updated" | "status.change" | "comment" | "dependency.change" | "assignment" | "field.change";
        at: string;
        message?: string | undefined;
        payload?: Record<string, unknown> | undefined;
    }[] | undefined;
    links?: {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[] | undefined;
    fields?: Record<string, unknown> | undefined;
}>;
export type NewTicketInput = z.infer<typeof newTicketInputSchema>;
export declare const ticketUpdateSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["backlog", "in_progress", "blocked", "review", "done", "archived"]>>;
    metadata: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodEnum<["low", "medium", "high", "critical"]>>>;
    assignees: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
    tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
    dependencies: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
    dueAt: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    links: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        url: z.ZodString;
        kind: z.ZodOptional<z.ZodDefault<z.ZodEnum<["doc", "issue", "pr", "design", "spec", "other"]>>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>, "many">>>;
    fields: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
} & {
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status?: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived" | undefined;
    metadata?: Record<string, unknown> | undefined;
    comment?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    priority?: "low" | "medium" | "high" | "critical" | undefined;
    assignees?: string[] | undefined;
    tags?: string[] | undefined;
    dependencies?: string[] | undefined;
    dueAt?: string | undefined;
    links?: {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[] | undefined;
    fields?: Record<string, unknown> | undefined;
}, {
    status?: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived" | undefined;
    metadata?: Record<string, unknown> | undefined;
    comment?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    priority?: "low" | "medium" | "high" | "critical" | undefined;
    assignees?: string[] | undefined;
    tags?: string[] | undefined;
    dependencies?: string[] | undefined;
    dueAt?: string | undefined;
    links?: {
        label: string;
        url: string;
        kind?: "doc" | "issue" | "pr" | "design" | "spec" | "other" | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[] | undefined;
    fields?: Record<string, unknown> | undefined;
}>;
export type TicketUpdate = z.infer<typeof ticketUpdateSchema>;
export declare const ticketIndexEntrySchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<["backlog", "in_progress", "blocked", "review", "done", "archived"]>;
    priority: z.ZodEnum<["low", "medium", "high", "critical"]>;
    assignees: z.ZodArray<z.ZodString, "many">;
    tags: z.ZodArray<z.ZodString, "many">;
    dependencies: z.ZodArray<z.ZodString, "many">;
    dependents: z.ZodArray<z.ZodString, "many">;
    updatedAt: z.ZodString;
    revision: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
    id: string;
    title: string;
    priority: "low" | "medium" | "high" | "critical";
    assignees: string[];
    tags: string[];
    dependencies: string[];
    dependents: string[];
    updatedAt: string;
    revision: number;
}, {
    status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
    id: string;
    title: string;
    priority: "low" | "medium" | "high" | "critical";
    assignees: string[];
    tags: string[];
    dependencies: string[];
    dependents: string[];
    updatedAt: string;
    revision: number;
}>;
export type TicketIndexEntry = z.infer<typeof ticketIndexEntrySchema>;
export declare const ticketIndexSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    tickets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        status: z.ZodEnum<["backlog", "in_progress", "blocked", "review", "done", "archived"]>;
        priority: z.ZodEnum<["low", "medium", "high", "critical"]>;
        assignees: z.ZodArray<z.ZodString, "many">;
        tags: z.ZodArray<z.ZodString, "many">;
        dependencies: z.ZodArray<z.ZodString, "many">;
        dependents: z.ZodArray<z.ZodString, "many">;
        updatedAt: z.ZodString;
        revision: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
        id: string;
        title: string;
        priority: "low" | "medium" | "high" | "critical";
        assignees: string[];
        tags: string[];
        dependencies: string[];
        dependents: string[];
        updatedAt: string;
        revision: number;
    }, {
        status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
        id: string;
        title: string;
        priority: "low" | "medium" | "high" | "critical";
        assignees: string[];
        tags: string[];
        dependencies: string[];
        dependents: string[];
        updatedAt: string;
        revision: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    generatedAt: string;
    tickets: {
        status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
        id: string;
        title: string;
        priority: "low" | "medium" | "high" | "critical";
        assignees: string[];
        tags: string[];
        dependencies: string[];
        dependents: string[];
        updatedAt: string;
        revision: number;
    }[];
}, {
    generatedAt: string;
    tickets: {
        status: "backlog" | "in_progress" | "blocked" | "review" | "done" | "archived";
        id: string;
        title: string;
        priority: "low" | "medium" | "high" | "critical";
        assignees: string[];
        tags: string[];
        dependencies: string[];
        dependents: string[];
        updatedAt: string;
        revision: number;
    }[];
}>;
export type TicketIndex = z.infer<typeof ticketIndexSchema>;
export declare const ticketDependencyGraphSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    nodes: z.ZodRecord<z.ZodString, z.ZodObject<{
        dependencies: z.ZodArray<z.ZodString, "many">;
        dependents: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        dependencies: string[];
        dependents: string[];
    }, {
        dependencies: string[];
        dependents: string[];
    }>>;
}, "strip", z.ZodTypeAny, {
    generatedAt: string;
    nodes: Record<string, {
        dependencies: string[];
        dependents: string[];
    }>;
}, {
    generatedAt: string;
    nodes: Record<string, {
        dependencies: string[];
        dependents: string[];
    }>;
}>;
export type TicketDependencyGraph = z.infer<typeof ticketDependencyGraphSchema>;
export interface SchemaExportOptions {
    title?: string;
}
export declare const buildTicketJsonSchema: (options?: SchemaExportOptions) => import("zod-to-json-schema").JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?: {
        [key: string]: import("zod-to-json-schema").JsonSchema7Type;
    } | undefined;
};
export declare const buildNewTicketJsonSchema: (options?: SchemaExportOptions) => import("zod-to-json-schema").JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?: {
        [key: string]: import("zod-to-json-schema").JsonSchema7Type;
    } | undefined;
};
export declare const buildTicketUpdateJsonSchema: (options?: SchemaExportOptions) => import("zod-to-json-schema").JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?: {
        [key: string]: import("zod-to-json-schema").JsonSchema7Type;
    } | undefined;
};
export declare const buildTicketIndexJsonSchema: (options?: SchemaExportOptions) => import("zod-to-json-schema").JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?: {
        [key: string]: import("zod-to-json-schema").JsonSchema7Type;
    } | undefined;
};
export declare const buildTicketDependencyGraphJsonSchema: (options?: SchemaExportOptions) => import("zod-to-json-schema").JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?: {
        [key: string]: import("zod-to-json-schema").JsonSchema7Type;
    } | undefined;
};
//# sourceMappingURL=schema.d.ts.map