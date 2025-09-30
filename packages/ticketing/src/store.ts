import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { nanoid } from 'nanoid';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  NewTicketInput,
  Ticket,
  TicketDependencyGraph,
  TicketIndex,
  TicketUpdate,
  newTicketInputSchema,
  ticketDependencyGraphSchema,
  ticketIdSchema,
  ticketIndexSchema,
  ticketSchema,
  ticketUpdateSchema
} from './schema';
import {
  TicketConflictError,
  TicketNotFoundError,
  TicketStoreError,
  TicketValidationError
} from './errors';

const DEFAULT_TICKET_EXTENSION = '.ticket.yaml';
const DEFAULT_INDEX_FILENAME = 'index.json';
const DEFAULT_DEPENDENCY_FILENAME = 'dependencies.json';
const DEFAULT_ACTOR = 'system';

const clone = <T>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

const uniquePreserveOrder = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
};

const slugify = (input: string): string => {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
};

interface DerivedArtifacts {
  index: TicketIndex;
  dependencyGraph: TicketDependencyGraph;
  tickets: Map<string, Ticket>;
}

export interface TicketStoreOptions {
  rootDir: string;
  ticketExtension?: string;
  indexFile?: string;
  dependencyFile?: string;
  defaultActor?: string;
}

export interface TicketMutationContext {
  actor?: string;
  message?: string;
}

export interface UpdateTicketOptions extends TicketMutationContext {
  expectedRevision?: number;
}

export interface DeleteTicketOptions {
  expectedRevision?: number;
}

type TicketStoreEvents = {
  'ticket:created': [ticket: Ticket];
  'ticket:updated': [ticket: Ticket];
  'ticket:deleted': [ticketId: string];
  'artifacts:rebuilt': [artifacts: DerivedArtifacts];
  'tickets:refreshed': [artifacts: DerivedArtifacts];
};

export class TicketStore extends EventEmitter<TicketStoreEvents> {
  private readonly rootDir: string;
  private readonly ticketExtension: string;
  private readonly indexFile: string;
  private readonly dependencyFile: string;
  private readonly defaultActor: string;
  private operationQueue: Promise<void> = Promise.resolve();
  private artifacts: DerivedArtifacts = {
    index: {
      generatedAt: new Date(0).toISOString(),
      tickets: []
    },
    dependencyGraph: {
      generatedAt: new Date(0).toISOString(),
      nodes: {}
    },
    tickets: new Map()
  };
  private initialized = false;

  constructor(options: TicketStoreOptions) {
    super();
    this.rootDir = path.resolve(options.rootDir);
    this.ticketExtension = options.ticketExtension ?? DEFAULT_TICKET_EXTENSION;
    this.indexFile = options.indexFile ?? path.join(this.rootDir, DEFAULT_INDEX_FILENAME);
    this.dependencyFile = options.dependencyFile ?? path.join(this.rootDir, DEFAULT_DEPENDENCY_FILENAME);
    this.defaultActor = options.defaultActor ?? DEFAULT_ACTOR;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(this.rootDir, { recursive: true });
    await this.rebuildArtifacts();
    this.initialized = true;
  }

  async listTickets(): Promise<Ticket[]> {
    await this.ensureInitialized();
    return Array.from(this.artifacts.tickets.values()).map((ticket) => clone(ticket));
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    await this.ensureInitialized();
    const parsedId = ticketIdSchema.parse(ticketId);
    const ticket = this.artifacts.tickets.get(parsedId);
    if (!ticket) {
      throw new TicketNotFoundError(parsedId);
    }
    return clone(ticket);
  }

  async getIndex(): Promise<TicketIndex> {
    await this.ensureInitialized();
    return clone(this.artifacts.index);
  }

  async getDependencyGraph(): Promise<TicketDependencyGraph> {
    await this.ensureInitialized();
    return clone(this.artifacts.dependencyGraph);
  }

  async createTicket(input: NewTicketInput, context: TicketMutationContext = {}): Promise<Ticket> {
    await this.ensureInitialized();
    return this.enqueue(async () => {
      const parsedInput = newTicketInputSchema.parse(input);
      const requestedId = parsedInput.id?.trim();
      const preferredId = requestedId && requestedId.length > 0 ? requestedId : slugify(parsedInput.title);
      const candidateId = preferredId && preferredId.length > 0 ? preferredId : `ticket-${nanoid(8).toLowerCase()}`;
      const id = await this.ensureUniqueTicketId(candidateId, Boolean(requestedId));
      const now = new Date().toISOString();

      const actor = (context.actor ?? this.defaultActor).trim() || this.defaultActor;
      const history = parsedInput.history ? parsedInput.history.map((entry) => ({ ...entry })) : [];
      history.push({
        id: nanoid(12),
        actor,
        action: 'created',
        at: now,
        message: context.message ?? 'Ticket created',
        payload: {
          status: parsedInput.status ?? 'backlog',
          priority: parsedInput.priority ?? 'medium'
        }
      });

      const ticket: Ticket = normalizeTicket({
        id,
        title: parsedInput.title,
        description: parsedInput.description,
        status: parsedInput.status ?? 'backlog',
        priority: parsedInput.priority ?? 'medium',
        assignees: parsedInput.assignees ?? [],
        tags: parsedInput.tags ?? [],
        dependencies: parsedInput.dependencies ?? [],
        dependents: [],
        createdAt: now,
        updatedAt: now,
        dueAt: parsedInput.dueAt,
        history,
        links: parsedInput.links ?? [],
        metadata: parsedInput.metadata,
        fields: parsedInput.fields,
        revision: 1
      });

      await this.writeTicketFile(ticket);
      await this.rebuildArtifacts();
      const created = this.artifacts.tickets.get(id);
      if (!created) {
        throw new TicketStoreError(`Ticket ${id} could not be loaded after creation`);
      }
      const cloned = clone(created);
      this.emit('ticket:created', cloned);
      return cloned;
    });
  }

  async updateTicket(ticketId: string, updates: TicketUpdate, options: UpdateTicketOptions = {}): Promise<Ticket> {
    await this.ensureInitialized();
    return this.enqueue(async () => {
      const id = ticketIdSchema.parse(ticketId);
      const parsedUpdates = ticketUpdateSchema.parse(updates);
      const existing = this.artifacts.tickets.get(id);

      if (!existing) {
        throw new TicketNotFoundError(id);
      }

      if (typeof options.expectedRevision === 'number' && existing.revision !== options.expectedRevision) {
        throw new TicketConflictError(
          `Ticket ${id} revision mismatch (expected ${options.expectedRevision}, found ${existing.revision})`
        );
      }

      const now = new Date().toISOString();
      const actor = (options.actor ?? this.defaultActor).trim() || this.defaultActor;

      const changedFields: string[] = [];
      const nextTicket = clone(existing);

      if (parsedUpdates.title && parsedUpdates.title !== existing.title) {
        nextTicket.title = parsedUpdates.title;
        changedFields.push('title');
      }

      if (parsedUpdates.description && parsedUpdates.description !== existing.description) {
        nextTicket.description = parsedUpdates.description;
        changedFields.push('description');
      }

      if (parsedUpdates.status && parsedUpdates.status !== existing.status) {
        nextTicket.status = parsedUpdates.status;
        changedFields.push('status');
      }

      if (parsedUpdates.priority && parsedUpdates.priority !== existing.priority) {
        nextTicket.priority = parsedUpdates.priority;
        changedFields.push('priority');
      }

      if (parsedUpdates.assignees !== undefined) {
        nextTicket.assignees = parsedUpdates.assignees;
        changedFields.push('assignees');
      }

      if (parsedUpdates.tags !== undefined) {
        nextTicket.tags = parsedUpdates.tags;
        changedFields.push('tags');
      }

      if (parsedUpdates.dependencies !== undefined) {
        nextTicket.dependencies = parsedUpdates.dependencies;
        changedFields.push('dependencies');
      }

      if (parsedUpdates.dueAt !== undefined) {
        nextTicket.dueAt = parsedUpdates.dueAt;
        changedFields.push('dueAt');
      }

      if (parsedUpdates.links !== undefined) {
        nextTicket.links = parsedUpdates.links;
        changedFields.push('links');
      }

      if (parsedUpdates.metadata !== undefined) {
        nextTicket.metadata = parsedUpdates.metadata;
        changedFields.push('metadata');
      }

      if (parsedUpdates.fields !== undefined) {
        nextTicket.fields = parsedUpdates.fields;
        changedFields.push('fields');
      }

      if (changedFields.length === 0 && !parsedUpdates.comment) {
        return clone(existing);
      }

      nextTicket.revision = existing.revision + 1;
      nextTicket.updatedAt = now;

      const history = [...nextTicket.history];

      if (changedFields.length > 0) {
        history.push({
          id: nanoid(12),
          actor,
          action: 'updated',
          at: now,
          message: options.message ?? 'Ticket updated',
          payload: {
            fields: changedFields
          }
        });
      }

      if (parsedUpdates.comment) {
        history.push({
          id: nanoid(12),
          actor,
          action: 'comment',
          at: now,
          message: parsedUpdates.comment
        });
      }

      nextTicket.history = history;

      const normalizedTicket = normalizeTicket(nextTicket);

      await this.writeTicketFile(normalizedTicket);
      await this.rebuildArtifacts();

      const updated = this.artifacts.tickets.get(id);
      if (!updated) {
        throw new TicketStoreError(`Ticket ${id} could not be loaded after update`);
      }
      const cloned = clone(updated);
      this.emit('ticket:updated', cloned);
      return cloned;
    });
  }

  async deleteTicket(ticketId: string, options: DeleteTicketOptions = {}): Promise<void> {
    await this.ensureInitialized();
    await this.enqueue(async () => {
      const id = ticketIdSchema.parse(ticketId);
      const existing = this.artifacts.tickets.get(id);
      if (!existing) {
        throw new TicketNotFoundError(id);
      }

      if (typeof options.expectedRevision === 'number' && existing.revision !== options.expectedRevision) {
        throw new TicketConflictError(
          `Ticket ${id} revision mismatch (expected ${options.expectedRevision}, found ${existing.revision})`
        );
      }

      await fs.rm(this.getTicketFilePath(id), { force: true });
      await this.rebuildArtifacts();
      this.emit('ticket:deleted', id);
    });
  }

  private async ensureUniqueTicketId(candidateId: string, strict: boolean): Promise<string> {
    const parsedId = ticketIdSchema.parse(candidateId);
    const existing = this.artifacts.tickets.has(parsedId) || (await this.fileExists(this.getTicketFilePath(parsedId)));
    if (!existing) {
      return parsedId;
    }

    if (strict) {
      throw new TicketConflictError(`Ticket id ${parsedId} already exists`);
    }

    let suffix = 1;
    while (true) {
      const attempt = `${parsedId}-${suffix}`;
      const alreadyExists =
        this.artifacts.tickets.has(attempt) || (await this.fileExists(this.getTicketFilePath(attempt)));
      if (!alreadyExists) {
        return attempt;
      }
      suffix += 1;
    }
  }

  private async fileExists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async writeTicketFile(ticket: Ticket): Promise<void> {
    const sanitized = sanitizeTicketForWrite(ticket);
    const yamlContent = `${stringifyYaml(sanitized, { aliasDuplicateObjects: false }).trim()}\n`;
    await fs.writeFile(this.getTicketFilePath(ticket.id), yamlContent, 'utf8');
  }

  private getTicketFilePath(ticketId: string): string {
    return path.join(this.rootDir, `${ticketId}${this.ticketExtension}`);
  }

  private async readTicketFile(filePath: string): Promise<Ticket> {
    const raw = await fs.readFile(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (error) {
      throw new TicketValidationError(`Failed to parse ticket file ${filePath}`, error);
    }

    const result = ticketSchema.safeParse(parsed);
    if (!result.success) {
      throw new TicketValidationError(`Ticket file ${filePath} failed validation`, result.error.format());
    }

    return normalizeTicket(result.data);
  }

  private async rebuildArtifacts(): Promise<void> {
    const files = await fs.readdir(this.rootDir);
    const yamlFiles = files.filter((file) => file.endsWith(this.ticketExtension));
    const tickets = await Promise.all(
      yamlFiles.map(async (file) => this.readTicketFile(path.join(this.rootDir, file)))
    );

    const dependencyGraph = buildDependencyGraph(tickets);
    const enrichedTickets = tickets.map((ticket) => ({
      ...ticket,
      dependents: dependencyGraph.nodes[ticket.id]?.dependents ?? []
    }));

    const index: TicketIndex = {
      generatedAt: new Date().toISOString(),
      tickets: enrichedTickets.map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        assignees: [...ticket.assignees],
        tags: [...ticket.tags],
        dependencies: [...ticket.dependencies],
        dependents: [...ticket.dependents],
        updatedAt: ticket.updatedAt,
        revision: ticket.revision
      }))
    };

    validateArtifacts(index, dependencyGraph);

    await fs.writeFile(this.indexFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    await fs.writeFile(this.dependencyFile, `${JSON.stringify(dependencyGraph, null, 2)}\n`, 'utf8');

    this.artifacts = {
      index,
      dependencyGraph,
      tickets: new Map(enrichedTickets.map((ticket) => [ticket.id, ticket]))
    };

    this.emit('artifacts:rebuilt', this.artifacts);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async refreshFromDisk(): Promise<void> {
    await this.ensureInitialized();
    await this.enqueue(async () => {
      await this.rebuildArtifacts();
      this.emit('tickets:refreshed', this.artifacts);
    });
  }

  getTicketExtension(): string {
    return this.ticketExtension;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }
}

const normalizeTicket = (ticket: Ticket): Ticket => {
  const dependencies = uniquePreserveOrder(ticket.dependencies.filter((dep) => dep !== ticket.id));
  const dependents = uniquePreserveOrder(ticket.dependents.filter((dep) => dep !== ticket.id));
  const assignees = uniquePreserveOrder(ticket.assignees.map((value) => value.trim()).filter(Boolean));
  const tags = uniquePreserveOrder(ticket.tags.map((value) => value.trim()).filter(Boolean));
  const links = ticket.links?.map((link) => ({ ...link })) ?? [];
  const history = ticket.history?.map((entry) => ({ ...entry })) ?? [];
  const metadata = ticket.metadata ? { ...ticket.metadata } : undefined;
  const fields = ticket.fields ? { ...ticket.fields } : undefined;

  return {
    ...ticket,
    dependencies,
    dependents,
    assignees,
    tags,
    links,
    history,
    metadata,
    fields
  };
};

const sanitizeTicketForWrite = (ticket: Ticket) => {
  const { dependents, ...rest } = normalizeTicket(ticket);
  return rest;
};

const buildDependencyGraph = (tickets: Ticket[]): TicketDependencyGraph => {
  const nodes: Record<string, { dependencies: string[]; dependents: string[] }> = {};

  for (const ticket of tickets) {
    nodes[ticket.id] = {
      dependencies: uniquePreserveOrder(ticket.dependencies),
      dependents: []
    };
  }

  for (const ticket of tickets) {
    for (const dependency of ticket.dependencies) {
      if (!nodes[dependency]) {
        nodes[dependency] = {
          dependencies: [],
          dependents: []
        };
      }
      if (!nodes[dependency].dependents.includes(ticket.id)) {
        nodes[dependency].dependents.push(ticket.id);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes
  };
};

const validateArtifacts = (index: TicketIndex, dependencyGraph: TicketDependencyGraph) => {
  const indexValidation = ticketIndexSchema.safeParse(index);
  if (!indexValidation.success) {
    throw new TicketValidationError('Generated ticket index failed validation', indexValidation.error.format());
  }

  const dependencyValidation = ticketDependencyGraphSchema.safeParse(dependencyGraph);
  if (!dependencyValidation.success) {
    throw new TicketValidationError(
      'Generated dependency graph failed validation',
      dependencyValidation.error.format()
    );
  }
};
