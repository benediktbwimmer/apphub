"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketValidationError = exports.TicketNotFoundError = exports.TicketConflictError = exports.TicketStoreError = void 0;
var TicketStoreError = /** @class */ (function (_super) {
    __extends(TicketStoreError, _super);
    function TicketStoreError(message) {
        var _this = _super.call(this, message) || this;
        _this.name = 'TicketStoreError';
        return _this;
    }
    return TicketStoreError;
}(Error));
exports.TicketStoreError = TicketStoreError;
var TicketConflictError = /** @class */ (function (_super) {
    __extends(TicketConflictError, _super);
    function TicketConflictError(message) {
        var _this = _super.call(this, message) || this;
        _this.code = 'TICKET_CONFLICT';
        _this.name = 'TicketConflictError';
        return _this;
    }
    return TicketConflictError;
}(TicketStoreError));
exports.TicketConflictError = TicketConflictError;
var TicketNotFoundError = /** @class */ (function (_super) {
    __extends(TicketNotFoundError, _super);
    function TicketNotFoundError(ticketId) {
        var _this = _super.call(this, "Ticket ".concat(ticketId, " was not found")) || this;
        _this.code = 'TICKET_NOT_FOUND';
        _this.name = 'TicketNotFoundError';
        return _this;
    }
    return TicketNotFoundError;
}(TicketStoreError));
exports.TicketNotFoundError = TicketNotFoundError;
var TicketValidationError = /** @class */ (function (_super) {
    __extends(TicketValidationError, _super);
    function TicketValidationError(message, issues) {
        var _this = _super.call(this, message) || this;
        _this.code = 'TICKET_VALIDATION_FAILED';
        _this.name = 'TicketValidationError';
        _this.issues = issues;
        return _this;
    }
    return TicketValidationError;
}(TicketStoreError));
exports.TicketValidationError = TicketValidationError;
//# sourceMappingURL=errors.js.map