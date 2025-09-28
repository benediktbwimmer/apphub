import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react';
import { Link } from 'react-router-dom';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useToastHelpers } from '../../components/toast';
import { Spinner } from '../../components';
import { listNamespaces } from '../api';
import {
  type MetastoreNamespaceSummary,
  type MetastoreNamespaceListResponse
} from '../types';
import { formatInstant } from '../utils';
import { ROUTE_PATHS } from '../../routes/paths';

const FAVORITES_STORAGE_KEY = 'apphub.metastore.namespaceFavorites';
const RECENTS_STORAGE_KEY = 'apphub.metastore.namespaceRecents';
const MAX_RECENT_ENTRIES = 5;
const DEFAULT_NAMESPACE_LIMIT = 50;

function loadStoredList(key: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

function persistList(key: string, values: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // ignore storage failures
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function normalizeNamespace(value: string): string {
  return value.trim();
}

type NamespaceOption = {
  name: string;
  summary: MetastoreNamespaceSummary | null;
  authorized: boolean;
  isFavorite: boolean;
  isRecent: boolean;
};

type NamespacePickerProps = {
  value: string;
  onChange: (namespace: string) => void;
  disabled?: boolean;
};

export function NamespacePicker({ value, onChange, disabled = false }: NamespacePickerProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showError } = useToastHelpers();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const hasDiscoveryRef = useRef(false);
  const labelId = useId();

  const [favorites, setFavorites] = useState<string[]>(() => loadStoredList(FAVORITES_STORAGE_KEY));
  const [recents, setRecents] = useState<string[]>(() => loadStoredList(RECENTS_STORAGE_KEY));
  const [namespaces, setNamespaces] = useState<MetastoreNamespaceSummary[]>([]);
  const [discoveredNamespaces, setDiscoveredNamespaces] = useState<MetastoreNamespaceSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(searchTerm, 250);

  const availableMap = useMemo(() => {
    const map = new Map<string, MetastoreNamespaceSummary>();
    for (const entry of discoveredNamespaces) {
      map.set(entry.name, entry);
    }
    return map;
  }, [discoveredNamespaces]);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);
  const recentsSet = useMemo(() => new Set(recents), [recents]);

  const trimmedValue = normalizeNamespace(value) || 'default';

  const hasAccessToSelected = availableMap.size === 0 || availableMap.has(trimmedValue);

  const buildOption = useCallback(
    (name: string): NamespaceOption => {
      const summary = availableMap.get(name) ?? null;
      return {
        name,
        summary,
        authorized: summary !== null,
        isFavorite: favoritesSet.has(name),
        isRecent: recentsSet.has(name)
      } satisfies NamespaceOption;
    },
    [availableMap, favoritesSet, recentsSet]
  );

  const trimmedSearchQuery = debouncedSearch.trim();
  const normalizedSearch = trimmedSearchQuery.toLowerCase();

  const filteredFavorites = useMemo(() => {
    return favorites
      .filter((name) => {
        if (!normalizedSearch) {
          return true;
        }
        return name.toLowerCase().includes(normalizedSearch);
      })
      .map((name) => buildOption(name));
  }, [favorites, normalizedSearch, buildOption]);

  const filteredRecents = useMemo(() => {
    return recents
      .filter((name) => !favoritesSet.has(name))
      .filter((name) => {
        if (!normalizedSearch) {
          return true;
        }
        return name.toLowerCase().includes(normalizedSearch);
      })
      .map((name) => buildOption(name));
  }, [recents, favoritesSet, normalizedSearch, buildOption]);

  const filteredAll = useMemo(() => {
    return namespaces
      .filter((entry) => !favoritesSet.has(entry.name) && !recentsSet.has(entry.name))
      .filter((entry) => {
        if (!normalizedSearch) {
          return true;
        }
        return entry.name.toLowerCase().includes(normalizedSearch);
      })
      .map((entry) => buildOption(entry.name));
  }, [namespaces, favoritesSet, recentsSet, normalizedSearch, buildOption]);

  const hasMatchingOptions = filteredFavorites.length > 0 || filteredRecents.length > 0 || filteredAll.length > 0;

  const manualEntryCandidate = useMemo(() => {
    const userInput = searchTerm.trim();
    if (!userInput) {
      return null;
    }
    const lower = userInput.toLowerCase();
    const existsInSuggestions =
      filteredFavorites.some((option) => option.name.toLowerCase() === lower) ||
      filteredRecents.some((option) => option.name.toLowerCase() === lower) ||
      filteredAll.some((option) => option.name.toLowerCase() === lower);
    if (existsInSuggestions) {
      return null;
    }
    return buildOption(userInput);
  }, [searchTerm, filteredFavorites, filteredRecents, filteredAll, buildOption]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setSearchTerm('');
  }, []);

  const updateFavorites = useCallback((updater: (prev: string[]) => string[]) => {
    setFavorites((prev) => {
      const next = updater(prev);
      persistList(FAVORITES_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const updateRecents = useCallback((updater: (prev: string[]) => string[]) => {
    setRecents((prev) => {
      const next = updater(prev);
      persistList(RECENTS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (name: string) => {
      const trimmed = normalizeNamespace(name);
      if (!trimmed) {
        return;
      }
      onChange(trimmed);
      updateRecents((prev) => {
        const withoutCurrent = prev.filter((entry) => entry !== trimmed);
        return [trimmed, ...withoutCurrent].slice(0, MAX_RECENT_ENTRIES);
      });
      closeDropdown();
    },
    [onChange, closeDropdown, updateRecents]
  );

  const toggleFavorite = useCallback(
    (name: string) => {
      updateFavorites((prev) => {
        const exists = prev.includes(name);
        return exists ? prev.filter((entry) => entry !== name) : [name, ...prev];
      });
    },
    [updateFavorites]
  );

  const handleFavoriteClick = (event: MouseEvent<HTMLButtonElement>, name: string) => {
    event.stopPropagation();
    event.preventDefault();
    toggleFavorite(name);
  };

  const fetchNamespaces = useCallback(
    async (search?: string, { showErrors }: { showErrors: boolean } = { showErrors: true }): Promise<boolean> => {
      if (!discoveryEnabled && !hasDiscoveryRef.current) {
        setDiscoveryEnabled(true);
      }
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      const controller = new AbortController();
      activeRequestRef.current = controller;
      setLoading(true);
      setLastError(null);
      const previouslyLoaded = hasDiscoveryRef.current;
      try {
        const response: MetastoreNamespaceListResponse = await listNamespaces(authorizedFetch, {
          prefix: search ? search.trim() : undefined,
          limit: DEFAULT_NAMESPACE_LIMIT,
          signal: controller.signal
        });
        setNamespaces(response.namespaces);
        hasDiscoveryRef.current = true;
        if (response.namespaces.length > 0) {
          setDiscoveredNamespaces((prev) => {
            const map = new Map(prev.map((item) => [item.name, item]));
            for (const entry of response.namespaces) {
              map.set(entry.name, entry);
            }
            return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
          });
        }
        setDiscoveryEnabled(true);
        return true;
      } catch (err) {
        if (controller.signal.aborted) {
          return false;
        }
        if (showErrors) {
          showError('Namespace discovery unavailable', err);
        }
        const message = err instanceof Error ? err.message : 'Namespace discovery failed';
        setLastError(message);
        if (!previouslyLoaded) {
          setDiscoveryEnabled(false);
        }
        return false;
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [authorizedFetch, showError]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const success = await fetchNamespaces(undefined, { showErrors: true });
      if (!active && activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      if (!success && !hasDiscoveryRef.current) {
        setDiscoveryEnabled(false);
      }
    })();
    return () => {
      active = false;
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
    };
  }, [fetchNamespaces]);

  useEffect(() => {
    if (!discoveryEnabled) {
      return;
    }
    if (trimmedSearchQuery === '') {
      return;
    }
    fetchNamespaces(trimmedSearchQuery, { showErrors: false }).catch(() => {
      // errors handled in fetchNamespaces
    });
  }, [trimmedSearchQuery, discoveryEnabled, fetchNamespaces]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, closeDropdown]);

  const handleFocus = () => {
    if (disabled) {
      return;
    }
    if (open) {
      return;
    }
    fetchNamespaces(undefined, { showErrors: false }).catch(() => {
      // handled in fetchNamespaces
    });
  };

  const handleControlClick = () => {
    if (disabled) {
      return;
    }
    if (open) {
      closeDropdown();
      return;
    }
    setOpen(true);
    fetchNamespaces(undefined, { showErrors: false }).catch(() => {
      // handled in fetchNamespaces
    });
  };

  const handleManualChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = normalizeNamespace(event.target.value);
    onChange(next);
  };

  const handleRetryDiscovery = async () => {
    setDiscoveryEnabled(true);
    const success = await fetchNamespaces(undefined, { showErrors: true });
    if (!success) {
      setDiscoveryEnabled(false);
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const fallback = manualEntryCandidate ?? filteredFavorites[0] ?? filteredRecents[0] ?? filteredAll[0];
      if (fallback) {
        handleSelect(fallback.name);
      }
    }
  };

  if (!discoveryEnabled) {
    return (
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor={labelId}
            className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400"
          >
            Namespace
          </label>
          <input
            id={labelId}
            type="text"
            disabled={disabled}
            value={trimmedValue}
            onChange={handleManualChange}
            className="w-48 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 text-sm text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Namespace discovery unavailable.</span>
          <button
            type="button"
            onClick={handleRetryDiscovery}
            className="rounded-full border border-slate-300/80 px-3 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
          >
            Retry
          </button>
          {lastError && <span className="text-[11px] text-rose-500 dark:text-rose-300">{lastError}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-2" ref={containerRef}>
      <label
        id={labelId}
        className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400"
      >
        Namespace
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={handleControlClick}
        onFocus={handleFocus}
        aria-labelledby={labelId}
        className={`flex w-48 items-center justify-between gap-3 rounded-full border border-slate-300/80 bg-white/80 px-4 py-2 text-left text-sm text-slate-700 shadow-sm transition-colors hover:border-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100 ${
          open ? 'border-violet-500' : ''
        }`}
      >
        <span className="truncate font-semibold">{trimmedValue}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">▼</span>
      </button>
      {!hasAccessToSelected && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-300">
          <span>No access to {trimmedValue}. Request access to view records.</span>
          <Link
            to={ROUTE_PATHS.settingsApiAccess}
            className="rounded-full border border-amber-500 px-2 py-1 font-semibold text-amber-600 transition-colors hover:bg-amber-500/10 dark:border-amber-300 dark:text-amber-200"
          >
            Manage scopes
          </Link>
        </div>
      )}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/95">
          <div className="flex items-center gap-2 border-b border-slate-200/60 px-4 py-3 dark:border-slate-700/60">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search namespaces"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100"
              autoFocus
            />
            {loading && <Spinner size="xs" />}
          </div>
          <div className="max-h-72 overflow-y-auto px-2 py-3 text-sm">
            {hasMatchingOptions ? (
              <div className="flex flex-col gap-3">
                {filteredFavorites.length > 0 && (
                  <section>
                    <header className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                      Favorites
                    </header>
                    <ul className="mt-2 space-y-1">
                      {filteredFavorites.map((option) => (
                        <NamespaceOptionRow
                          key={`favorite-${option.name}`}
                          option={option}
                          onSelect={handleSelect}
                          onToggleFavorite={handleFavoriteClick}
                          isActive={trimmedValue === option.name}
                        />
                      ))}
                    </ul>
                  </section>
                )}
                {filteredRecents.length > 0 && (
                  <section>
                    <header className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                      Recent
                    </header>
                    <ul className="mt-2 space-y-1">
                      {filteredRecents.map((option) => (
                        <NamespaceOptionRow
                          key={`recent-${option.name}`}
                          option={option}
                          onSelect={handleSelect}
                          onToggleFavorite={handleFavoriteClick}
                          isActive={trimmedValue === option.name}
                        />
                      ))}
                    </ul>
                  </section>
                )}
                {filteredAll.length > 0 && (
                  <section>
                    {filteredFavorites.length > 0 || filteredRecents.length > 0 ? (
                      <header className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                        All namespaces
                      </header>
                    ) : null}
                    <ul className="mt-2 space-y-1">
                      {filteredAll.map((option) => (
                        <NamespaceOptionRow
                          key={`namespace-${option.name}`}
                          option={option}
                          onSelect={handleSelect}
                          onToggleFavorite={handleFavoriteClick}
                          isActive={trimmedValue === option.name}
                        />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
                No namespaces found. Adjust your search or add manually below.
              </div>
            )}
            {manualEntryCandidate && (
              <div className="mt-2 border-t border-slate-200/60 pt-3 text-sm text-slate-600 dark:border-slate-700/60 dark:text-slate-300">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl border border-dashed border-slate-300/80 px-4 py-2 text-left transition-colors hover:border-violet-500 hover:bg-violet-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70"
                  onClick={() => handleSelect(manualEntryCandidate.name)}
                >
                  <span>
                    Use namespace <strong>{manualEntryCandidate.name}</strong>
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Enter</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type NamespaceOptionRowProps = {
  option: NamespaceOption;
  onSelect: (name: string) => void;
  onToggleFavorite: (event: MouseEvent<HTMLButtonElement>, name: string) => void;
  isActive: boolean;
};

function NamespaceOptionRow({ option, onSelect, onToggleFavorite, isActive }: NamespaceOptionRowProps) {
  const { name, summary, authorized, isFavorite } = option;
  const secondary = useMemo(() => {
    if (!summary) {
      return null;
    }
    const parts: string[] = [];
    parts.push(`${formatCount(summary.totalRecords)} records`);
    if (summary.deletedRecords > 0) {
      parts.push(`${formatCount(summary.deletedRecords)} deleted`);
    }
    if (summary.lastUpdatedAt) {
      parts.push(`Updated ${formatInstant(summary.lastUpdatedAt)}`);
    }
    return parts.join(' • ');
  }, [summary]);

  const handleClick = () => {
    if (!authorized) {
      return;
    }
    onSelect(name);
  };

  const selectionClasses = [
    'flex flex-1 flex-col gap-1 rounded-2xl px-4 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500',
    authorized
      ? 'border border-transparent hover:bg-violet-500/10 text-slate-700 dark:text-slate-200'
      : 'border border-dashed border-amber-400/60 bg-amber-50/60 text-amber-700 cursor-not-allowed dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-200',
    isActive && authorized ? 'border border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li>
      <div className="flex w-full items-start gap-3">
        <button type="button" onClick={handleClick} className={selectionClasses} disabled={!authorized}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{name}</span>
            {isActive && authorized && (
              <span className="rounded-full bg-violet-500/10 px-2 py-[2px] text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                Active
              </span>
            )}
          </div>
          {authorized ? (
            secondary ? <span className="text-xs text-slate-500 dark:text-slate-400">{secondary}</span> : null
          ) : (
            <span className="text-xs text-amber-600 dark:text-amber-300">
              No access. Request additional scopes from settings.
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={(event) => onToggleFavorite(event, name)}
          className={`mt-1 flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
            isFavorite ? 'text-yellow-500' : 'text-slate-400 hover:text-violet-500 dark:text-slate-500 dark:hover:text-violet-300'
          }`}
          aria-label={isFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
        >
          <StarIcon filled={isFavorite} />
        </button>
      </div>
    </li>
  );
}

type StarIconProps = {
  filled: boolean;
};

function StarIcon({ filled }: StarIconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.2}
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M10 1.8l2.4 4.86 5.36.78-3.88 3.78.92 5.34L10 13.9l-4.8 2.56.92-5.34-3.88-3.78 5.36-.78L10 1.8z" />
    </svg>
  );
}
