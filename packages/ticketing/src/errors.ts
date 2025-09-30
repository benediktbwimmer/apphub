export class TicketStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketStoreError';
  }
}

export class TicketConflictError extends TicketStoreError {
  readonly code = 'TICKET_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'TicketConflictError';
  }
}

export class TicketNotFoundError extends TicketStoreError {
  readonly code = 'TICKET_NOT_FOUND';

  constructor(ticketId: string) {
    super(`Ticket ${ticketId} was not found`);
    this.name = 'TicketNotFoundError';
  }
}

export class TicketValidationError extends TicketStoreError {
  readonly code = 'TICKET_VALIDATION_FAILED';
  readonly issues: unknown;

  constructor(message: string, issues: unknown) {
    super(message);
    this.name = 'TicketValidationError';
    this.issues = issues;
  }
}
