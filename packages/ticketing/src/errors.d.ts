export declare class TicketStoreError extends Error {
    constructor(message: string);
}
export declare class TicketConflictError extends TicketStoreError {
    readonly code = "TICKET_CONFLICT";
    constructor(message: string);
}
export declare class TicketNotFoundError extends TicketStoreError {
    readonly code = "TICKET_NOT_FOUND";
    constructor(ticketId: string);
}
export declare class TicketValidationError extends TicketStoreError {
    readonly code = "TICKET_VALIDATION_FAILED";
    readonly issues: unknown;
    constructor(message: string, issues: unknown);
}
//# sourceMappingURL=errors.d.ts.map