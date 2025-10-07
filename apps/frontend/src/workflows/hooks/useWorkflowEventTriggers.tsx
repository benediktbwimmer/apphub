import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useWorkflowDefinitions } from './useWorkflowDefinitions';
import {
  createWorkflowEventTrigger,
  cancelEventRetry,
  cancelTriggerRetry,
  cancelWorkflowStepRetry,
  deleteWorkflowEventTrigger,
  forceEventRetry,
  forceTriggerRetry,
  forceWorkflowStepRetry,
  getWorkflowEventHealth,
  listWorkflowEventSamples,
  listWorkflowEventTriggers,
  listWorkflowTriggerDeliveries,
  updateWorkflowEventTrigger,
  type WorkflowEventSampleQuery,
  type WorkflowEventTriggerCreateInput,
  type WorkflowEventTriggerFilters,
  type WorkflowEventTriggerUpdateInput,
  type WorkflowTriggerDeliveriesQuery
} from '../api';
import type {
  WorkflowEventSample,
  WorkflowEventSchema,
  WorkflowEventSchedulerHealth,
  WorkflowEventTrigger,
  WorkflowTriggerDelivery
} from '../types';
import { ApiError } from '../api';
import { useModuleScope } from '../../modules/ModuleScopeContext';


type TriggerDeliveryState = {
  items: WorkflowTriggerDelivery[];
  loading: boolean;
  error: string | null;
  limit: number;
  query?: WorkflowTriggerDeliveriesQuery;
  lastFetchedAt?: string;
};

type EventTriggerListState = {
  items: WorkflowEventTrigger[];
  loading: boolean;
  error: string | null;
  filters?: WorkflowEventTriggerFilters;
  lastFetchedAt?: string;
};

type EventSamplesState = {
  items: WorkflowEventSample[];
  schema: WorkflowEventSchema | null;
  loading: boolean;
  error: string | null;
  query: WorkflowEventSampleQuery | null;
  lastFetchedAt?: string;
};

type WorkflowEventTriggersContextValue = {
  eventTriggers: WorkflowEventTrigger[];
  eventTriggersLoading: boolean;
  eventTriggersError: string | null;
  selectedEventTrigger: WorkflowEventTrigger | null;
  selectedEventTriggerId: string | null;
  setSelectedEventTriggerId: Dispatch<SetStateAction<string | null>>;
  loadEventTriggers: (slug: string, options?: { filters?: WorkflowEventTriggerFilters; force?: boolean }) => Promise<void>;
  createEventTrigger: (slug: string, input: WorkflowEventTriggerCreateInput) => Promise<WorkflowEventTrigger>;
  updateEventTrigger: (slug: string, triggerId: string, input: WorkflowEventTriggerUpdateInput) => Promise<WorkflowEventTrigger>;
  deleteEventTrigger: (slug: string, triggerId: string) => Promise<void>;
  triggerDeliveries: WorkflowTriggerDelivery[];
  triggerDeliveriesLoading: boolean;
  triggerDeliveriesError: string | null;
  triggerDeliveriesLimit: number;
  triggerDeliveriesQuery: WorkflowTriggerDeliveriesQuery | undefined;
  loadTriggerDeliveries: (slug: string, triggerId: string, query?: WorkflowTriggerDeliveriesQuery) => Promise<void>;
  eventSamples: WorkflowEventSample[];
  eventSchema: WorkflowEventSchema | null;
  eventSamplesLoading: boolean;
  eventSamplesError: string | null;
  eventSamplesQuery: WorkflowEventSampleQuery | null;
  loadEventSamples: (query?: WorkflowEventSampleQuery) => Promise<void>;
  refreshEventSamples: () => void;
  eventHealth: WorkflowEventSchedulerHealth | null;
  eventHealthLoading: boolean;
  eventHealthError: string | null;
  loadEventSchedulerHealth: () => Promise<void>;
  cancelEventRetry: (eventId: string) => Promise<void>;
  forceEventRetry: (eventId: string) => Promise<void>;
  cancelTriggerRetry: (deliveryId: string) => Promise<void>;
  forceTriggerRetry: (deliveryId: string) => Promise<void>;
  cancelWorkflowStepRetry: (stepId: string) => Promise<void>;
  forceWorkflowStepRetry: (stepId: string) => Promise<void>;
  pendingEventRetryId: string | null;
  pendingTriggerRetryId: string | null;
  pendingWorkflowRetryId: string | null;
};

const WorkflowEventTriggersContext = createContext<WorkflowEventTriggersContextValue | undefined>(undefined);

export function WorkflowEventTriggersProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch, pushToast } = useWorkflowAccess();
  const { selectedSlug } = useWorkflowDefinitions();
  const moduleScope = useModuleScope();
  const { kind: moduleScopeKind, isResourceInScope } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';

  const [eventTriggerState, setEventTriggerState] = useState<Record<string, EventTriggerListState>>({});
  const eventTriggerStateRef = useRef<Record<string, EventTriggerListState>>({});
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);
  const selectedTriggerIdRef = useRef<string | null>(null);

  const [triggerDeliveryState, setTriggerDeliveryState] = useState<Record<string, TriggerDeliveryState>>({});

  const [eventSamplesState, setEventSamplesState] = useState<EventSamplesState>({
    items: [],
    schema: null,
    loading: false,
    error: null,
    query: null
  });

  const [eventHealth, setEventHealth] = useState<WorkflowEventSchedulerHealth | null>(null);
  const [eventHealthLoading, setEventHealthLoading] = useState(false);
  const [eventHealthError, setEventHealthError] = useState<string | null>(null);

  const [pendingEventRetryId, setPendingEventRetryId] = useState<string | null>(null);
  const [pendingTriggerRetryId, setPendingTriggerRetryId] = useState<string | null>(null);
  const [pendingWorkflowRetryId, setPendingWorkflowRetryId] = useState<string | null>(null);

  const eventTriggersEntry = selectedSlug ? eventTriggerState[selectedSlug] : undefined;
  const eventTriggers = useMemo(
    () => (eventTriggersEntry ? eventTriggersEntry.items : []),
    [eventTriggersEntry]
  );
  const eventTriggersLoading = eventTriggersEntry?.loading ?? false;
  const eventTriggersError = eventTriggersEntry?.error ?? null;

  const selectedEventTrigger = useMemo(() => {
    if (!eventTriggers.length) {
      return null;
    }
    if (!selectedTriggerId) {
      return eventTriggers[0];
    }
    const match = eventTriggers.find((trigger) => trigger.id === selectedTriggerId);
    return match ?? eventTriggers[0];
  }, [eventTriggers, selectedTriggerId]);

  const triggerDeliveriesEntry = selectedEventTrigger ? triggerDeliveryState[selectedEventTrigger.id] : undefined;
  const triggerDeliveries = useMemo(
    () => triggerDeliveriesEntry?.items ?? [],
    [triggerDeliveriesEntry]
  );
  const triggerDeliveriesLoading = triggerDeliveriesEntry?.loading ?? false;
  const triggerDeliveriesError = triggerDeliveriesEntry?.error ?? null;
  const triggerDeliveriesLimit = triggerDeliveriesEntry?.limit ?? 50;
  const triggerDeliveriesQuery = triggerDeliveriesEntry?.query;

  const loadEventTriggers = useCallback(
    async (slug: string, options: { filters?: WorkflowEventTriggerFilters; force?: boolean } = {}) => {
      if (!slug) {
        return;
      }
      if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      const currentState = eventTriggerStateRef.current;
      const filters: WorkflowEventTriggerFilters = {
        ...(currentState[slug]?.filters ?? {}),
        ...(options.filters ?? {})
      };
      const nextFilters = Object.keys(filters).length > 0 ? filters : undefined;
      if (!options.force && currentState[slug]?.loading) {
        return;
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: nextFilters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        const response = await listWorkflowEventTriggers(authorizedFetch, slug, filters);
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: response.triggers,
            loading: false,
            error: null,
            filters: nextFilters,
            lastFetchedAt: new Date().toISOString()
          }
        }));
        if (selectedSlug === slug) {
          setSelectedTriggerId((currentId) => {
            if (currentId && response.triggers.some((trigger) => trigger.id === currentId)) {
              return currentId;
            }
            return response.triggers.length > 0 ? response.triggers[0].id : null;
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load workflow event triggers';
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: message,
            filters: nextFilters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          pushToast({
            tone: 'error',
            title: 'Workflow event triggers',
            description: message
          });
        }
      }
    },
    [authorizedFetch, isModuleScoped, isResourceInScope, pushToast, selectedSlug]
  );

  const handleEventTriggerCreated = useCallback(
    (slug: string, trigger: WorkflowEventTrigger) => {
      setEventTriggerState((current) => {
        const entry = current[slug];
        const items = entry ? [...entry.items, trigger] : [trigger];
        return {
          ...current,
          [slug]: {
            items,
            loading: false,
            error: null,
            filters: entry?.filters,
            lastFetchedAt: new Date().toISOString()
          }
        } satisfies Record<string, EventTriggerListState>;
      });
    },
    []
  );

  const handleEventTriggerUpdated = useCallback(
    (slug: string, trigger: WorkflowEventTrigger) => {
      setEventTriggerState((current) => {
        const entry = current[slug];
        const items = entry
          ? entry.items.map((existing) => (existing.id === trigger.id ? trigger : existing))
          : [trigger];
        return {
          ...current,
          [slug]: {
            items,
            loading: false,
            error: null,
            filters: entry?.filters,
            lastFetchedAt: new Date().toISOString()
          }
        } satisfies Record<string, EventTriggerListState>;
      });
    },
    []
  );

  const handleEventTriggerDeleted = useCallback((slug: string, triggerId: string) => {
    let remaining: WorkflowEventTrigger[] = [];
    setEventTriggerState((current) => {
      const entry = current[slug];
      if (!entry) {
        return current;
      }
      remaining = entry.items.filter((trigger) => trigger.id !== triggerId);
      return {
        ...current,
        [slug]: {
          items: remaining,
          loading: false,
          error: null,
          filters: entry.filters,
          lastFetchedAt: new Date().toISOString()
        }
      } satisfies Record<string, EventTriggerListState>;
    });
    if (selectedSlug === slug) {
      setSelectedTriggerId((currentId) => {
        if (currentId === triggerId) {
          return remaining.length > 0 ? remaining[0].id : null;
        }
        return currentId;
      });
    }
  }, [selectedSlug]);

  const createEventTrigger = useCallback(
    async (slug: string, input: WorkflowEventTriggerCreateInput) => {
      if (!slug) {
        throw new Error('Workflow slug is required');
      }
      if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
        throw new Error('Workflow is not in the active module scope');
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: current[slug]?.filters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        const created = await createWorkflowEventTrigger(authorizedFetch, slug, input);
        handleEventTriggerCreated(slug, created);
        pushToast({
          tone: 'success',
          title: 'Event trigger created',
          description: 'Trigger ready for deliveries.'
        });
        return created;
      } catch (error) {
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: current[slug]?.error ?? null,
            filters: current[slug]?.filters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        if (!(error instanceof ApiError && error.status === 400)) {
          const message = error instanceof Error ? error.message : 'Failed to create event trigger';
          pushToast({
            tone: 'error',
            title: 'Event trigger create failed',
            description: message
          });
        }
        throw error;
      }
    },
    [authorizedFetch, handleEventTriggerCreated, isModuleScoped, isResourceInScope, pushToast]
  );

  const updateEventTrigger = useCallback(
    async (slug: string, triggerId: string, input: WorkflowEventTriggerUpdateInput) => {
      if (!slug) {
        throw new Error('Workflow slug is required');
      }
      if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
        throw new Error('Workflow is not in the active module scope');
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: current[slug]?.filters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        const updated = await updateWorkflowEventTrigger(authorizedFetch, slug, triggerId, input);
        handleEventTriggerUpdated(slug, updated);
        pushToast({
          tone: 'success',
          title: 'Event trigger updated',
          description: 'Trigger changes saved.'
        });
        return updated;
      } catch (error) {
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: current[slug]?.error ?? null,
            filters: current[slug]?.filters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        if (!(error instanceof ApiError && error.status === 400)) {
          const message = error instanceof Error ? error.message : 'Failed to update event trigger';
          pushToast({
            tone: 'error',
            title: 'Event trigger update failed',
            description: message
          });
        }
        throw error;
      }
    },
    [authorizedFetch, handleEventTriggerUpdated, isModuleScoped, isResourceInScope, pushToast]
  );

  const deleteEventTrigger = useCallback(
    async (slug: string, triggerId: string) => {
      if (!slug) {
        throw new Error('Workflow slug is required');
      }
      if (!triggerId) {
        throw new Error('Trigger id is required');
      }
      if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
        throw new Error('Workflow is not in the active module scope');
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: current[slug]?.filters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        await deleteWorkflowEventTrigger(authorizedFetch, slug, triggerId);
        handleEventTriggerDeleted(slug, triggerId);
        pushToast({
          tone: 'success',
          title: 'Event trigger deleted',
          description: 'Trigger removed from workflow.'
        });
      } catch (error) {
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: current[slug]?.error ?? null,
            filters: current[slug]?.filters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        const message = error instanceof Error ? error.message : 'Failed to delete event trigger';
        pushToast({
          tone: 'error',
          title: 'Event trigger delete failed',
          description: message
        });
        throw error;
      }
    },
    [authorizedFetch, handleEventTriggerDeleted, isModuleScoped, isResourceInScope, pushToast]
  );

  const loadTriggerDeliveries = useCallback(
    async (slug: string, triggerId: string, query: WorkflowTriggerDeliveriesQuery = {}) => {
      if (!slug || !triggerId) {
        return;
      }
      if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      setTriggerDeliveryState((current) => {
        const entry = current[triggerId] ?? {
          items: [],
          loading: false,
          error: null,
          limit: query.limit ?? 50
        };
        return {
          ...current,
          [triggerId]: {
            ...entry,
            loading: true,
            error: null,
            limit: query.limit ?? entry.limit,
            query,
            lastFetchedAt: entry.lastFetchedAt
          }
        } satisfies Record<string, TriggerDeliveryState>;
      });
      try {
        const response = await listWorkflowTriggerDeliveries(authorizedFetch, slug, triggerId, query);
        setTriggerDeliveryState((current) => ({
          ...current,
          [triggerId]: {
            items: response.deliveries,
            loading: false,
            error: null,
            limit: response.limit,
            query,
            lastFetchedAt: new Date().toISOString()
          }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load trigger deliveries';
        setTriggerDeliveryState((current) => ({
          ...current,
          [triggerId]: {
            items: current[triggerId]?.items ?? [],
            loading: false,
            error: message,
            limit: current[triggerId]?.limit ?? query.limit ?? 50,
            query,
            lastFetchedAt: current[triggerId]?.lastFetchedAt
          }
        }));
        pushToast({
          tone: 'error',
          title: 'Delivery history refresh failed',
          description: message
        });
      }
    },
    [authorizedFetch, isModuleScoped, isResourceInScope, pushToast]
  );

  const loadEventSamples = useCallback(
    async (query: WorkflowEventSampleQuery = {}) => {
      setEventSamplesState((current) => ({
        ...current,
        loading: true,
        error: null,
        query
      }));
      try {
        const { samples, schema } = await listWorkflowEventSamples(authorizedFetch, query);
        setEventSamplesState({
          items: samples,
          schema: schema ?? null,
          loading: false,
          error: null,
          query,
          lastFetchedAt: new Date().toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load event samples';
        setEventSamplesState((current) => ({
          ...current,
          loading: false,
          error: message
        }));
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          pushToast({
            tone: 'error',
            title: 'Event samples unavailable',
            description: message
          });
        }
      }
    },
    [authorizedFetch, pushToast]
  );

  const refreshEventSamples = useCallback(() => {
    if (eventSamplesState.query) {
      void loadEventSamples(eventSamplesState.query);
    } else {
      void loadEventSamples({});
    }
  }, [eventSamplesState.query, loadEventSamples]);

  const loadEventSchedulerHealth = useCallback(async () => {
    setEventHealthLoading(true);
    setEventHealthError(null);
    try {
      const health = await getWorkflowEventHealth(authorizedFetch);
      setEventHealth(health);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load event health';
      setEventHealthError(message);
      if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
        pushToast({
          tone: 'error',
          title: 'Event health unavailable',
          description: message
        });
      }
    } finally {
      setEventHealthLoading(false);
    }
  }, [authorizedFetch, pushToast]);

  const handleCancelEventRetry = useCallback(
    async (eventId: string) => {
      setPendingEventRetryId(eventId);
      try {
        await cancelEventRetry(authorizedFetch, eventId);
        pushToast({
          tone: 'success',
          title: 'Event retry cancelled',
          description: 'The event retry was cancelled.'
        });
        await loadEventSchedulerHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel event retry';
        pushToast({
          tone: 'error',
          title: 'Unable to cancel event retry',
          description: message
        });
      } finally {
        setPendingEventRetryId((current) => (current === eventId ? null : current));
      }
    },
    [authorizedFetch, loadEventSchedulerHealth, pushToast]
  );

  const handleForceEventRetry = useCallback(
    async (eventId: string) => {
      setPendingEventRetryId(eventId);
      try {
        await forceEventRetry(authorizedFetch, eventId);
        pushToast({
          tone: 'success',
          title: 'Event retry queued',
          description: 'The event retry will run shortly.'
        });
        await loadEventSchedulerHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to enqueue event retry';
        pushToast({
          tone: 'error',
          title: 'Unable to run event retry',
          description: message
        });
      } finally {
        setPendingEventRetryId((current) => (current === eventId ? null : current));
      }
    },
    [authorizedFetch, loadEventSchedulerHealth, pushToast]
  );

  const handleCancelTriggerRetry = useCallback(
    async (deliveryId: string) => {
      setPendingTriggerRetryId(deliveryId);
      try {
        await cancelTriggerRetry(authorizedFetch, deliveryId);
        pushToast({
          tone: 'success',
          title: 'Trigger retry cancelled',
          description: 'The trigger delivery retry was cancelled.'
        });
        await loadEventSchedulerHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel trigger retry';
        pushToast({
          tone: 'error',
          title: 'Unable to cancel trigger retry',
          description: message
        });
      } finally {
        setPendingTriggerRetryId((current) => (current === deliveryId ? null : current));
      }
    },
    [authorizedFetch, loadEventSchedulerHealth, pushToast]
  );

  const handleForceTriggerRetry = useCallback(
    async (deliveryId: string) => {
      setPendingTriggerRetryId(deliveryId);
      try {
        await forceTriggerRetry(authorizedFetch, deliveryId);
        pushToast({
          tone: 'success',
          title: 'Trigger retry queued',
          description: 'The trigger delivery retry will run shortly.'
        });
        await loadEventSchedulerHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run trigger retry';
        pushToast({
          tone: 'error',
          title: 'Unable to run trigger retry',
          description: message
        });
      } finally {
        setPendingTriggerRetryId((current) => (current === deliveryId ? null : current));
      }
    },
    [authorizedFetch, loadEventSchedulerHealth, pushToast]
  );

  const handleCancelWorkflowStepRetry = useCallback(
    async (stepId: string) => {
      setPendingWorkflowRetryId(stepId);
      try {
        await cancelWorkflowStepRetry(authorizedFetch, stepId);
        pushToast({
          tone: 'success',
          title: 'Workflow retry cancelled',
          description: 'The workflow step retry was cancelled.'
        });
        await loadEventSchedulerHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel workflow retry';
        pushToast({
          tone: 'error',
          title: 'Unable to cancel workflow retry',
          description: message
        });
      } finally {
        setPendingWorkflowRetryId((current) => (current === stepId ? null : current));
      }
    },
    [authorizedFetch, loadEventSchedulerHealth, pushToast]
  );

  const handleForceWorkflowStepRetry = useCallback(
    async (stepId: string) => {
      setPendingWorkflowRetryId(stepId);
      try {
        await forceWorkflowStepRetry(authorizedFetch, stepId);
        pushToast({
          tone: 'success',
          title: 'Workflow retry queued',
          description: 'The workflow step retry will run shortly.'
        });
        await loadEventSchedulerHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run workflow retry';
        pushToast({
          tone: 'error',
          title: 'Unable to run workflow retry',
          description: message
        });
      } finally {
        setPendingWorkflowRetryId((current) => (current === stepId ? null : current));
      }
    },
    [authorizedFetch, loadEventSchedulerHealth, pushToast]
  );

  useEffect(() => {
    eventTriggerStateRef.current = eventTriggerState;
  }, [eventTriggerState]);

  useEffect(() => {
    selectedTriggerIdRef.current = selectedTriggerId;
  }, [selectedTriggerId]);

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedTriggerId(null);
      return;
    }
    if (isModuleScoped && !isResourceInScope('workflow-definition', selectedSlug)) {
      setSelectedTriggerId(null);
      return;
    }
    void loadEventTriggers(selectedSlug, { force: true });
    void loadEventSchedulerHealth();
  }, [isModuleScoped, isResourceInScope, loadEventSchedulerHealth, loadEventTriggers, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) {
      return;
    }
    if (isModuleScoped && !isResourceInScope('workflow-definition', selectedSlug)) {
      setSelectedTriggerId(null);
      return;
    }
    const entry = eventTriggerState[selectedSlug];
    if (!entry || entry.items.length === 0) {
      setSelectedTriggerId(null);
      return;
    }
    setSelectedTriggerId((currentId) => {
      if (currentId && entry.items.some((trigger) => trigger.id === currentId)) {
        return currentId;
      }
      return entry.items[0].id;
    });
  }, [eventTriggerState, isModuleScoped, isResourceInScope, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug || !selectedEventTrigger) {
      return;
    }
    if (isModuleScoped && !isResourceInScope('workflow-definition', selectedSlug)) {
      return;
    }
    void loadTriggerDeliveries(selectedSlug, selectedEventTrigger.id);
  }, [isModuleScoped, isResourceInScope, loadTriggerDeliveries, selectedEventTrigger, selectedSlug]);

  const value = useMemo<WorkflowEventTriggersContextValue>(
    () => ({
      eventTriggers,
      eventTriggersLoading,
      eventTriggersError,
      selectedEventTrigger,
      selectedEventTriggerId: selectedTriggerId,
      setSelectedEventTriggerId: setSelectedTriggerId,
      loadEventTriggers,
      createEventTrigger,
      updateEventTrigger,
      deleteEventTrigger,
      triggerDeliveries,
      triggerDeliveriesLoading,
      triggerDeliveriesError,
      triggerDeliveriesLimit,
      triggerDeliveriesQuery,
      loadTriggerDeliveries,
      eventSamples: eventSamplesState.items,
      eventSchema: eventSamplesState.schema,
      eventSamplesLoading: eventSamplesState.loading,
      eventSamplesError: eventSamplesState.error,
      eventSamplesQuery: eventSamplesState.query,
      loadEventSamples,
      refreshEventSamples,
      eventHealth,
      eventHealthLoading,
      eventHealthError,
      loadEventSchedulerHealth,
      cancelEventRetry: handleCancelEventRetry,
      forceEventRetry: handleForceEventRetry,
      cancelTriggerRetry: handleCancelTriggerRetry,
      forceTriggerRetry: handleForceTriggerRetry,
      cancelWorkflowStepRetry: handleCancelWorkflowStepRetry,
      forceWorkflowStepRetry: handleForceWorkflowStepRetry,
      pendingEventRetryId,
      pendingTriggerRetryId,
      pendingWorkflowRetryId
    }),
    [
      eventTriggers,
      eventTriggersLoading,
      eventTriggersError,
      selectedEventTrigger,
      selectedTriggerId,
      loadEventTriggers,
      createEventTrigger,
      updateEventTrigger,
      deleteEventTrigger,
      triggerDeliveries,
      triggerDeliveriesLoading,
      triggerDeliveriesError,
      triggerDeliveriesLimit,
      triggerDeliveriesQuery,
      loadTriggerDeliveries,
      eventSamplesState,
      loadEventSamples,
      refreshEventSamples,
      eventHealth,
      eventHealthLoading,
      eventHealthError,
      loadEventSchedulerHealth,
      handleCancelEventRetry,
      handleForceEventRetry,
      handleCancelTriggerRetry,
      handleForceTriggerRetry,
      handleCancelWorkflowStepRetry,
      handleForceWorkflowStepRetry,
      pendingEventRetryId,
      pendingTriggerRetryId,
      pendingWorkflowRetryId
    ]
  );

  return <WorkflowEventTriggersContext.Provider value={value}>{children}</WorkflowEventTriggersContext.Provider>;
}

export function useWorkflowEventTriggers() {
  const context = useContext(WorkflowEventTriggersContext);
  if (!context) {
    throw new Error('useWorkflowEventTriggers must be used within WorkflowEventTriggersProvider');
  }
  return context;
}
