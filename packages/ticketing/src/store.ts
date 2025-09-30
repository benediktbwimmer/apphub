import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import { nanoid } from 'nanoid';

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

const DEFAULT_DATABASE_FILENAME = 'tickets.db';
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface DerivedArtifacts {
  index: TicketIndex;
  dependencyGraph: TicketDependencyGraph;
  tickets: Map<string, Ticket>;
}

export interface TicketStoreOptions {
  rootDir: string;
  databaseFile?: string;
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

type TicketRow = {
  id: string;
  data: string;
};

export class TicketStore extends EventEmitter<TicketStoreEvents> {
  private readonly rootDir: string;
  private readonly databaseFile: string;
  private readonly defaultActor: string;
  private db: SqliteDatabase | null = null;
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
    this.databaseFile = options.databaseFile
      ? path.resolve(options.databaseFile)
      : path.join(this.rootDir, DEFAULT_DATABASE_FILENAME);
    this.defaultActor = options.defaultActor ?? DEFAULT_ACTOR;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(this.rootDir, { recursive: true });
    try {
      this.db = new Database(this.databaseFile);
    } catch (error) {
      const message = `Failed to open ticket database at ${this.databaseFile}: ${(error as Error).message}`;
      throw new TicketStoreError(message);
    }

    const db = this.getDb();
    await this.configureDatabase(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.rebuildArtifacts();
    this.initialized = true;
  }

  async listTickets(): Promise<Ticket[]> {
    await this.ensureInitialized();
    await this.waitForPendingOperations();
    const artifacts = this.readArtifactsFromDatabase();
    return Array.from(artifacts.tickets.values()).map((ticket) => clone(ticket));
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    await this.ensureInitialized();
    const parsedId = ticketIdSchema.parse(ticketId);
    await this.waitForPendingOperations();
    const artifacts = this.readArtifactsFromDatabase();
    const ticket = artifacts.tickets.get(parsedId);
    if (!ticket) {
      throw new TicketNotFoundError(parsedId);
    }
    return clone(ticket);
  }

  async getIndex(): Promise<TicketIndex> {
    await this.ensureInitialized();
    await this.waitForPendingOperations();
    const artifacts = this.readArtifactsFromDatabase();
    return clone(artifacts.index);
  }

  async getDependencyGraph(): Promise<TicketDependencyGraph> {
    await this.ensureInitialized();
    await this.waitForPendingOperations();
    const artifacts = this.readArtifactsFromDatabase();
    return clone(artifacts.dependencyGraph);
  }

  async createTicket(input: NewTicketInput, context: TicketMutationContext = {}): Promise<Ticket> {
    await this.ensureInitialized();
    return this.enqueue(async () => {
      this.artifacts = this.readArtifactsFromDatabase();
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

      this.writeTicketRecord(ticket);
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
      this.artifacts = this.readArtifactsFromDatabase();
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

      this.writeTicketRecord(normalizedTicket);
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
      this.artifacts = this.readArtifactsFromDatabase();
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

      const db = this.getDb();
      const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
      if (result.changes === 0) {
        throw new TicketNotFoundError(id);
      }

      await this.rebuildArtifacts();
      this.emit('ticket:deleted', id);
    });
  }

  private writeTicketRecord(ticket: Ticket): void {
    const sanitized = sanitizeTicketForWrite(ticket);
    const payload = JSON.stringify(sanitized);
    const db = this.getDb();
    db.prepare(
      `INSERT INTO tickets (id, data, revision, created_at, updated_at)
       VALUES (@id, @data, @revision, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         data = excluded.data,
         revision = excluded.revision,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run({
      id: ticket.id,
      data: payload,
      revision: sanitized.revision,
      createdAt: sanitized.createdAt,
      updatedAt: sanitized.updatedAt
    });
  }

  private ticketExistsInDatabase(ticketId: string): boolean {
    const db = this.getDb();
    const row = db.prepare('SELECT 1 FROM tickets WHERE id = ? LIMIT 1').get(ticketId);
    return Boolean(row);
  }

  private async ensureUniqueTicketId(candidateId: string, strict: boolean): Promise<string> {
    const parsedId = ticketIdSchema.parse(candidateId);
    const existing = this.artifacts.tickets.has(parsedId) || this.ticketExistsInDatabase(parsedId);
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
        this.artifacts.tickets.has(attempt) || this.ticketExistsInDatabase(attempt);
      if (!alreadyExists) {
        return attempt;
      }
      suffix += 1;
    }
  }

  private getDb(): SqliteDatabase {
    if (!this.db) {
      throw new TicketStoreError('Ticket store has not been initialized');
    }
    return this.db;
  }

  private async configureDatabase(db: SqliteDatabase): Promise<void> {
    db.pragma('busy_timeout = 5000');
    await this.ensureWalJournalMode(db);
    db.pragma('foreign_keys = ON');
  }

  private async ensureWalJournalMode(db: SqliteDatabase): Promise<void> {
    const maxAttempts = 5;
    const baseDelayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = db.pragma('journal_mode = WAL', { simple: true });
        if (typeof result === 'string' && result.toLowerCase() === 'wal') {
          return;
        }

        throw new TicketStoreError(
          `Ticket database returned unexpected journal mode ${String(result)} while enabling WAL`
        );
      } catch (error) {
        if (!this.isBusySqliteError(error)) {
          const message = (error as Error)?.message ?? 'Unknown error';
          throw new TicketStoreError(`Failed to enable WAL journal mode for ticket database: ${message}`);
        }

        const delayMs = baseDelayMs * (attempt + 1);
        await sleep(delayMs);
      }
    }

    try {
      const currentMode = db.pragma('journal_mode', { simple: true });
      if (typeof currentMode === 'string' && currentMode.toLowerCase() === 'wal') {
        return;
      }
    } catch (error) {
      if (this.isBusySqliteError(error)) {
        throw new TicketStoreError('Timed out while waiting for WAL journal mode to become available');
      }
      const message = (error as Error)?.message ?? 'Unknown error';
      throw new TicketStoreError(`Failed to read ticket database journal mode: ${message}`);
    }

    throw new TicketStoreError('Timed out enabling WAL journal mode for ticket database');
  }

  private isBusySqliteError(error: unknown): error is { code: string } {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'SQLITE_BUSY');
  }

  private async waitForPendingOperations(): Promise<void> {
    await this.operationQueue;
  }

  private readArtifactsFromDatabase(): DerivedArtifacts {
    const db = this.getDb();
    const rows = db.prepare('SELECT id, data FROM tickets ORDER BY id ASC').all() as TicketRow[];
    const tickets = rows.map((row) => this.deserializeTicketRow(row));

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

    return {
      index,
      dependencyGraph,
      tickets: new Map(enrichedTickets.map((ticket) => [ticket.id, ticket]))
    };
  }

  private async rebuildArtifacts(): Promise<void> {
    const artifacts = this.readArtifactsFromDatabase();
    this.artifacts = artifacts;
    this.emit('artifacts:rebuilt', this.artifacts);
  }

  private deserializeTicketRow(row: TicketRow): Ticket {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch (error) {
      throw new TicketValidationError(`Failed to parse stored ticket ${row.id}`, error);
    }

    const result = ticketSchema.safeParse(parsed);
    if (!result.success) {
      throw new TicketValidationError(`Stored ticket ${row.id} failed validation`, result.error.format());
    }

    return normalizeTicket({ ...result.data });
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

  getDatabasePath(): string {
    return this.databaseFile;
  }

  getTicketExtension(): string {
    const ext = path.extname(this.databaseFile);
    return ext || '.db';
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
