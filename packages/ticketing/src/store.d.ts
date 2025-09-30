import { EventEmitter } from 'node:events';
import { NewTicketInput, Ticket, TicketDependencyGraph, TicketIndex, TicketUpdate } from './schema';
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
export declare class TicketStore extends EventEmitter<TicketStoreEvents> {
    private readonly rootDir;
    private readonly ticketExtension;
    private readonly indexFile;
    private readonly dependencyFile;
    private readonly defaultActor;
    private operationQueue;
    private artifacts;
    private initialized;
    constructor(options: TicketStoreOptions);
    init(): Promise<void>;
    listTickets(): Promise<Ticket[]>;
    getTicket(ticketId: string): Promise<Ticket>;
    getIndex(): Promise<TicketIndex>;
    getDependencyGraph(): Promise<TicketDependencyGraph>;
    createTicket(input: NewTicketInput, context?: TicketMutationContext): Promise<Ticket>;
    updateTicket(ticketId: string, updates: TicketUpdate, options?: UpdateTicketOptions): Promise<Ticket>;
    deleteTicket(ticketId: string, options?: DeleteTicketOptions): Promise<void>;
    private ensureUniqueTicketId;
    private fileExists;
    private writeTicketFile;
    private getTicketFilePath;
    private readTicketFile;
    private rebuildArtifacts;
    private enqueue;
    refreshFromDisk(): Promise<void>;
    getTicketExtension(): string;
    getRootDir(): string;
    private ensureInitialized;
}
export {};
//# sourceMappingURL=store.d.ts.map