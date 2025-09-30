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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketStore = void 0;
var node_events_1 = require("node:events");
var node_fs_1 = require("node:fs");
var node_path_1 = __importDefault(require("node:path"));
var nanoid_1 = require("nanoid");
var yaml_1 = require("yaml");
var schema_1 = require("./schema");
var errors_1 = require("./errors");
var DEFAULT_TICKET_EXTENSION = '.ticket.yaml';
var DEFAULT_INDEX_FILENAME = 'index.json';
var DEFAULT_DEPENDENCY_FILENAME = 'dependencies.json';
var DEFAULT_ACTOR = 'system';
var clone = function (value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
};
var uniquePreserveOrder = function (values) {
    var seen = new Set();
    var result = [];
    for (var _i = 0, values_1 = values; _i < values_1.length; _i++) {
        var value = values_1[_i];
        if (!seen.has(value)) {
            seen.add(value);
            result.push(value);
        }
    }
    return result;
};
var slugify = function (input) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
};
var TicketStore = /** @class */ (function (_super) {
    __extends(TicketStore, _super);
    function TicketStore(options) {
        var _a, _b, _c, _d;
        var _this = _super.call(this) || this;
        _this.operationQueue = Promise.resolve();
        _this.artifacts = {
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
        _this.initialized = false;
        _this.rootDir = node_path_1.default.resolve(options.rootDir);
        _this.ticketExtension = (_a = options.ticketExtension) !== null && _a !== void 0 ? _a : DEFAULT_TICKET_EXTENSION;
        _this.indexFile = (_b = options.indexFile) !== null && _b !== void 0 ? _b : node_path_1.default.join(_this.rootDir, DEFAULT_INDEX_FILENAME);
        _this.dependencyFile = (_c = options.dependencyFile) !== null && _c !== void 0 ? _c : node_path_1.default.join(_this.rootDir, DEFAULT_DEPENDENCY_FILENAME);
        _this.defaultActor = (_d = options.defaultActor) !== null && _d !== void 0 ? _d : DEFAULT_ACTOR;
        return _this;
    }
    TicketStore.prototype.init = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.initialized) {
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, node_fs_1.promises.mkdir(this.rootDir, { recursive: true })];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.rebuildArtifacts()];
                    case 2:
                        _a.sent();
                        this.initialized = true;
                        return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.listTickets = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, Array.from(this.artifacts.tickets.values()).map(function (ticket) { return clone(ticket); })];
                }
            });
        });
    };
    TicketStore.prototype.getTicket = function (ticketId) {
        return __awaiter(this, void 0, void 0, function () {
            var parsedId, ticket;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        parsedId = schema_1.ticketIdSchema.parse(ticketId);
                        ticket = this.artifacts.tickets.get(parsedId);
                        if (!ticket) {
                            throw new errors_1.TicketNotFoundError(parsedId);
                        }
                        return [2 /*return*/, clone(ticket)];
                }
            });
        });
    };
    TicketStore.prototype.getIndex = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, clone(this.artifacts.index)];
                }
            });
        });
    };
    TicketStore.prototype.getDependencyGraph = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, clone(this.artifacts.dependencyGraph)];
                }
            });
        });
    };
    TicketStore.prototype.createTicket = function (input_1) {
        return __awaiter(this, arguments, void 0, function (input, context) {
            var _this = this;
            if (context === void 0) { context = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, this.enqueue(function () { return __awaiter(_this, void 0, void 0, function () {
                                var parsedInput, requestedId, preferredId, candidateId, id, now, actor, history, ticket, created, cloned;
                                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                                return __generator(this, function (_m) {
                                    switch (_m.label) {
                                        case 0:
                                            parsedInput = schema_1.newTicketInputSchema.parse(input);
                                            requestedId = (_a = parsedInput.id) === null || _a === void 0 ? void 0 : _a.trim();
                                            preferredId = requestedId && requestedId.length > 0 ? requestedId : slugify(parsedInput.title);
                                            candidateId = preferredId && preferredId.length > 0 ? preferredId : "ticket-".concat((0, nanoid_1.nanoid)(8).toLowerCase());
                                            return [4 /*yield*/, this.ensureUniqueTicketId(candidateId, Boolean(requestedId))];
                                        case 1:
                                            id = _m.sent();
                                            now = new Date().toISOString();
                                            actor = ((_b = context.actor) !== null && _b !== void 0 ? _b : this.defaultActor).trim() || this.defaultActor;
                                            history = parsedInput.history ? parsedInput.history.map(function (entry) { return (__assign({}, entry)); }) : [];
                                            history.push({
                                                id: (0, nanoid_1.nanoid)(12),
                                                actor: actor,
                                                action: 'created',
                                                at: now,
                                                message: (_c = context.message) !== null && _c !== void 0 ? _c : 'Ticket created',
                                                payload: {
                                                    status: (_d = parsedInput.status) !== null && _d !== void 0 ? _d : 'backlog',
                                                    priority: (_e = parsedInput.priority) !== null && _e !== void 0 ? _e : 'medium'
                                                }
                                            });
                                            ticket = normalizeTicket({
                                                id: id,
                                                title: parsedInput.title,
                                                description: parsedInput.description,
                                                status: (_f = parsedInput.status) !== null && _f !== void 0 ? _f : 'backlog',
                                                priority: (_g = parsedInput.priority) !== null && _g !== void 0 ? _g : 'medium',
                                                assignees: (_h = parsedInput.assignees) !== null && _h !== void 0 ? _h : [],
                                                tags: (_j = parsedInput.tags) !== null && _j !== void 0 ? _j : [],
                                                dependencies: (_k = parsedInput.dependencies) !== null && _k !== void 0 ? _k : [],
                                                dependents: [],
                                                createdAt: now,
                                                updatedAt: now,
                                                dueAt: parsedInput.dueAt,
                                                history: history,
                                                links: (_l = parsedInput.links) !== null && _l !== void 0 ? _l : [],
                                                metadata: parsedInput.metadata,
                                                fields: parsedInput.fields,
                                                revision: 1
                                            });
                                            return [4 /*yield*/, this.writeTicketFile(ticket)];
                                        case 2:
                                            _m.sent();
                                            return [4 /*yield*/, this.rebuildArtifacts()];
                                        case 3:
                                            _m.sent();
                                            created = this.artifacts.tickets.get(id);
                                            if (!created) {
                                                throw new errors_1.TicketStoreError("Ticket ".concat(id, " could not be loaded after creation"));
                                            }
                                            cloned = clone(created);
                                            this.emit('ticket:created', cloned);
                                            return [2 /*return*/, cloned];
                                    }
                                });
                            }); })];
                }
            });
        });
    };
    TicketStore.prototype.updateTicket = function (ticketId_1, updates_1) {
        return __awaiter(this, arguments, void 0, function (ticketId, updates, options) {
            var _this = this;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, this.enqueue(function () { return __awaiter(_this, void 0, void 0, function () {
                                var id, parsedUpdates, existing, now, actor, changedFields, nextTicket, history, normalizedTicket, updated, cloned;
                                var _a, _b;
                                return __generator(this, function (_c) {
                                    switch (_c.label) {
                                        case 0:
                                            id = schema_1.ticketIdSchema.parse(ticketId);
                                            parsedUpdates = schema_1.ticketUpdateSchema.parse(updates);
                                            existing = this.artifacts.tickets.get(id);
                                            if (!existing) {
                                                throw new errors_1.TicketNotFoundError(id);
                                            }
                                            if (typeof options.expectedRevision === 'number' && existing.revision !== options.expectedRevision) {
                                                throw new errors_1.TicketConflictError("Ticket ".concat(id, " revision mismatch (expected ").concat(options.expectedRevision, ", found ").concat(existing.revision, ")"));
                                            }
                                            now = new Date().toISOString();
                                            actor = ((_a = options.actor) !== null && _a !== void 0 ? _a : this.defaultActor).trim() || this.defaultActor;
                                            changedFields = [];
                                            nextTicket = clone(existing);
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
                                                return [2 /*return*/, clone(existing)];
                                            }
                                            nextTicket.revision = existing.revision + 1;
                                            nextTicket.updatedAt = now;
                                            history = __spreadArray([], nextTicket.history, true);
                                            if (changedFields.length > 0) {
                                                history.push({
                                                    id: (0, nanoid_1.nanoid)(12),
                                                    actor: actor,
                                                    action: 'updated',
                                                    at: now,
                                                    message: (_b = options.message) !== null && _b !== void 0 ? _b : 'Ticket updated',
                                                    payload: {
                                                        fields: changedFields
                                                    }
                                                });
                                            }
                                            if (parsedUpdates.comment) {
                                                history.push({
                                                    id: (0, nanoid_1.nanoid)(12),
                                                    actor: actor,
                                                    action: 'comment',
                                                    at: now,
                                                    message: parsedUpdates.comment
                                                });
                                            }
                                            nextTicket.history = history;
                                            normalizedTicket = normalizeTicket(nextTicket);
                                            return [4 /*yield*/, this.writeTicketFile(normalizedTicket)];
                                        case 1:
                                            _c.sent();
                                            return [4 /*yield*/, this.rebuildArtifacts()];
                                        case 2:
                                            _c.sent();
                                            updated = this.artifacts.tickets.get(id);
                                            if (!updated) {
                                                throw new errors_1.TicketStoreError("Ticket ".concat(id, " could not be loaded after update"));
                                            }
                                            cloned = clone(updated);
                                            this.emit('ticket:updated', cloned);
                                            return [2 /*return*/, cloned];
                                    }
                                });
                            }); })];
                }
            });
        });
    };
    TicketStore.prototype.deleteTicket = function (ticketId_1) {
        return __awaiter(this, arguments, void 0, function (ticketId, options) {
            var _this = this;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.enqueue(function () { return __awaiter(_this, void 0, void 0, function () {
                                var id, existing;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            id = schema_1.ticketIdSchema.parse(ticketId);
                                            existing = this.artifacts.tickets.get(id);
                                            if (!existing) {
                                                throw new errors_1.TicketNotFoundError(id);
                                            }
                                            if (typeof options.expectedRevision === 'number' && existing.revision !== options.expectedRevision) {
                                                throw new errors_1.TicketConflictError("Ticket ".concat(id, " revision mismatch (expected ").concat(options.expectedRevision, ", found ").concat(existing.revision, ")"));
                                            }
                                            return [4 /*yield*/, node_fs_1.promises.rm(this.getTicketFilePath(id), { force: true })];
                                        case 1:
                                            _a.sent();
                                            return [4 /*yield*/, this.rebuildArtifacts()];
                                        case 2:
                                            _a.sent();
                                            this.emit('ticket:deleted', id);
                                            return [2 /*return*/];
                                    }
                                });
                            }); })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.ensureUniqueTicketId = function (candidateId, strict) {
        return __awaiter(this, void 0, void 0, function () {
            var parsedId, existing, _a, suffix, attempt, alreadyExists, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        parsedId = schema_1.ticketIdSchema.parse(candidateId);
                        _a = this.artifacts.tickets.has(parsedId);
                        if (_a) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.fileExists(this.getTicketFilePath(parsedId))];
                    case 1:
                        _a = (_c.sent());
                        _c.label = 2;
                    case 2:
                        existing = _a;
                        if (!existing) {
                            return [2 /*return*/, parsedId];
                        }
                        if (strict) {
                            throw new errors_1.TicketConflictError("Ticket id ".concat(parsedId, " already exists"));
                        }
                        suffix = 1;
                        _c.label = 3;
                    case 3:
                        if (!true) return [3 /*break*/, 6];
                        attempt = "".concat(parsedId, "-").concat(suffix);
                        _b = this.artifacts.tickets.has(attempt);
                        if (_b) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.fileExists(this.getTicketFilePath(attempt))];
                    case 4:
                        _b = (_c.sent());
                        _c.label = 5;
                    case 5:
                        alreadyExists = _b;
                        if (!alreadyExists) {
                            return [2 /*return*/, attempt];
                        }
                        suffix += 1;
                        return [3 /*break*/, 3];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.fileExists = function (target) {
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, node_fs_1.promises.stat(target)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 2:
                        error_1 = _a.sent();
                        if (error_1.code === 'ENOENT') {
                            return [2 /*return*/, false];
                        }
                        throw error_1;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.writeTicketFile = function (ticket) {
        return __awaiter(this, void 0, void 0, function () {
            var sanitized, yamlContent;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        sanitized = sanitizeTicketForWrite(ticket);
                        yamlContent = "".concat((0, yaml_1.stringify)(sanitized, { aliasDuplicateObjects: false }).trim(), "\n");
                        return [4 /*yield*/, node_fs_1.promises.writeFile(this.getTicketFilePath(ticket.id), yamlContent, 'utf8')];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.getTicketFilePath = function (ticketId) {
        return node_path_1.default.join(this.rootDir, "".concat(ticketId).concat(this.ticketExtension));
    };
    TicketStore.prototype.readTicketFile = function (filePath) {
        return __awaiter(this, void 0, void 0, function () {
            var raw, parsed, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, node_fs_1.promises.readFile(filePath, 'utf8')];
                    case 1:
                        raw = _a.sent();
                        try {
                            parsed = (0, yaml_1.parse)(raw);
                        }
                        catch (error) {
                            throw new errors_1.TicketValidationError("Failed to parse ticket file ".concat(filePath), error);
                        }
                        result = schema_1.ticketSchema.safeParse(parsed);
                        if (!result.success) {
                            throw new errors_1.TicketValidationError("Ticket file ".concat(filePath, " failed validation"), result.error.format());
                        }
                        return [2 /*return*/, normalizeTicket(result.data)];
                }
            });
        });
    };
    TicketStore.prototype.rebuildArtifacts = function () {
        return __awaiter(this, void 0, void 0, function () {
            var files, yamlFiles, tickets, dependencyGraph, enrichedTickets, index;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, node_fs_1.promises.readdir(this.rootDir)];
                    case 1:
                        files = _a.sent();
                        yamlFiles = files.filter(function (file) { return file.endsWith(_this.ticketExtension); });
                        return [4 /*yield*/, Promise.all(yamlFiles.map(function (file) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, this.readTicketFile(node_path_1.default.join(this.rootDir, file))];
                            }); }); }))];
                    case 2:
                        tickets = _a.sent();
                        dependencyGraph = buildDependencyGraph(tickets);
                        enrichedTickets = tickets.map(function (ticket) {
                            var _a, _b;
                            return (__assign(__assign({}, ticket), { dependents: (_b = (_a = dependencyGraph.nodes[ticket.id]) === null || _a === void 0 ? void 0 : _a.dependents) !== null && _b !== void 0 ? _b : [] }));
                        });
                        index = {
                            generatedAt: new Date().toISOString(),
                            tickets: enrichedTickets.map(function (ticket) { return ({
                                id: ticket.id,
                                title: ticket.title,
                                status: ticket.status,
                                priority: ticket.priority,
                                assignees: __spreadArray([], ticket.assignees, true),
                                tags: __spreadArray([], ticket.tags, true),
                                dependencies: __spreadArray([], ticket.dependencies, true),
                                dependents: __spreadArray([], ticket.dependents, true),
                                updatedAt: ticket.updatedAt,
                                revision: ticket.revision
                            }); })
                        };
                        validateArtifacts(index, dependencyGraph);
                        return [4 /*yield*/, node_fs_1.promises.writeFile(this.indexFile, "".concat(JSON.stringify(index, null, 2), "\n"), 'utf8')];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, node_fs_1.promises.writeFile(this.dependencyFile, "".concat(JSON.stringify(dependencyGraph, null, 2), "\n"), 'utf8')];
                    case 4:
                        _a.sent();
                        this.artifacts = {
                            index: index,
                            dependencyGraph: dependencyGraph,
                            tickets: new Map(enrichedTickets.map(function (ticket) { return [ticket.id, ticket]; }))
                        };
                        this.emit('artifacts:rebuilt', this.artifacts);
                        return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.enqueue = function (operation) {
        var run = this.operationQueue.then(operation);
        this.operationQueue = run.then(function () { return undefined; }, function () { return undefined; });
        return run;
    };
    TicketStore.prototype.refreshFromDisk = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureInitialized()];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.enqueue(function () { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this.rebuildArtifacts()];
                                        case 1:
                                            _a.sent();
                                            this.emit('tickets:refreshed', this.artifacts);
                                            return [2 /*return*/];
                                    }
                                });
                            }); })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TicketStore.prototype.getTicketExtension = function () {
        return this.ticketExtension;
    };
    TicketStore.prototype.getRootDir = function () {
        return this.rootDir;
    };
    TicketStore.prototype.ensureInitialized = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!!this.initialized) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.init()];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    return TicketStore;
}(node_events_1.EventEmitter));
exports.TicketStore = TicketStore;
var normalizeTicket = function (ticket) {
    var _a, _b, _c, _d;
    var dependencies = uniquePreserveOrder(ticket.dependencies.filter(function (dep) { return dep !== ticket.id; }));
    var dependents = uniquePreserveOrder(ticket.dependents.filter(function (dep) { return dep !== ticket.id; }));
    var assignees = uniquePreserveOrder(ticket.assignees.map(function (value) { return value.trim(); }).filter(Boolean));
    var tags = uniquePreserveOrder(ticket.tags.map(function (value) { return value.trim(); }).filter(Boolean));
    var links = (_b = (_a = ticket.links) === null || _a === void 0 ? void 0 : _a.map(function (link) { return (__assign({}, link)); })) !== null && _b !== void 0 ? _b : [];
    var history = (_d = (_c = ticket.history) === null || _c === void 0 ? void 0 : _c.map(function (entry) { return (__assign({}, entry)); })) !== null && _d !== void 0 ? _d : [];
    var metadata = ticket.metadata ? __assign({}, ticket.metadata) : undefined;
    var fields = ticket.fields ? __assign({}, ticket.fields) : undefined;
    return __assign(__assign({}, ticket), { dependencies: dependencies, dependents: dependents, assignees: assignees, tags: tags, links: links, history: history, metadata: metadata, fields: fields });
};
var sanitizeTicketForWrite = function (ticket) {
    var _a = normalizeTicket(ticket), dependents = _a.dependents, rest = __rest(_a, ["dependents"]);
    return rest;
};
var buildDependencyGraph = function (tickets) {
    var nodes = {};
    for (var _i = 0, tickets_1 = tickets; _i < tickets_1.length; _i++) {
        var ticket = tickets_1[_i];
        nodes[ticket.id] = {
            dependencies: uniquePreserveOrder(ticket.dependencies),
            dependents: []
        };
    }
    for (var _a = 0, tickets_2 = tickets; _a < tickets_2.length; _a++) {
        var ticket = tickets_2[_a];
        for (var _b = 0, _c = ticket.dependencies; _b < _c.length; _b++) {
            var dependency = _c[_b];
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
        nodes: nodes
    };
};
var validateArtifacts = function (index, dependencyGraph) {
    var indexValidation = schema_1.ticketIndexSchema.safeParse(index);
    if (!indexValidation.success) {
        throw new errors_1.TicketValidationError('Generated ticket index failed validation', indexValidation.error.format());
    }
    var dependencyValidation = schema_1.ticketDependencyGraphSchema.safeParse(dependencyGraph);
    if (!dependencyValidation.success) {
        throw new errors_1.TicketValidationError('Generated dependency graph failed validation', dependencyValidation.error.format());
    }
};
//# sourceMappingURL=store.js.map