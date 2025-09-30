import classNames from 'classnames';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
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
import {
  METASTORE_CONTROL_ICON_CLASSES,
  METASTORE_CONTROL_TRIGGER_CLASSES,
  METASTORE_DROPDOWN_EMPTY_TEXT_CLASSES,
  METASTORE_DROPDOWN_PANEL_CLASSES,
  METASTORE_DROPDOWN_SEARCH_CLASSES,
  METASTORE_DROPDOWN_SEARCH_INPUT_CLASSES,
  METASTORE_DROPDOWN_SECTION_HEADER_CLASSES,
  METASTORE_ERROR_TEXT_CLASSES,
  METASTORE_FAVORITE_BUTTON_ACTIVE_CLASSES,
  METASTORE_FAVORITE_BUTTON_BASE_CLASSES,
  METASTORE_HELPER_ROW_CLASSES,
  METASTORE_INLINE_BUTTON_CLASSES,
  METASTORE_INPUT_COMPACT_CLASSES,
  METASTORE_MANUAL_ENTRY_BUTTON_CLASSES,
  METASTORE_MANUAL_ENTRY_CONTAINER_CLASSES,
  METASTORE_OPTION_BADGE_ACTIVE_CLASSES,
  METASTORE_OPTION_BUTTON_ACTIVE_CLASSES,
  METASTORE_OPTION_BUTTON_AUTHORIZED_CLASSES,
  METASTORE_OPTION_BUTTON_BASE_CLASSES,
  METASTORE_OPTION_BUTTON_DISABLED_CLASSES,
  METASTORE_OPTION_SECONDARY_TEXT_CLASSES,
  METASTORE_OPTION_WARNING_TEXT_CLASSES,
  METASTORE_SECTION_LABEL_CLASSES,
  METASTORE_WARNING_LINK_CLASSES,
  METASTORE_WARNING_NOTE_CLASSES
} from '../metastoreTokens';

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

  const handleFavoriteClick = (event: ReactMouseEvent<HTMLButtonElement>, name: string) => {
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
    [authorizedFetch, discoveryEnabled, showError]
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

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
          <label htmlFor={labelId} className={METASTORE_SECTION_LABEL_CLASSES}>
            Namespace
          </label>
          <input
            id={labelId}
            type="text"
            disabled={disabled}
            value={trimmedValue}
            onChange={handleManualChange}
            className={METASTORE_INPUT_COMPACT_CLASSES}
          />
        </div>
        <div className={METASTORE_HELPER_ROW_CLASSES}>
          <span>Namespace discovery unavailable.</span>
          <button type="button" onClick={handleRetryDiscovery} className={METASTORE_INLINE_BUTTON_CLASSES}>
            Retry
          </button>
          {lastError ? <span className={METASTORE_ERROR_TEXT_CLASSES}>{lastError}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-2" ref={containerRef}>
      <label id={labelId} className={METASTORE_SECTION_LABEL_CLASSES}>
        Namespace
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={handleControlClick}
        onFocus={handleFocus}
        aria-labelledby={labelId}
        className={classNames(METASTORE_CONTROL_TRIGGER_CLASSES, open ? 'border-accent' : undefined)}
      >
        <span className="truncate font-weight-semibold">{trimmedValue}</span>
        <span className={METASTORE_CONTROL_ICON_CLASSES}>▼</span>
      </button>
      {!hasAccessToSelected && (
        <div className={classNames('flex items-center gap-2', METASTORE_WARNING_NOTE_CLASSES)}>
          <span>No access to {trimmedValue}. Request access to view records.</span>
          <Link
            to={ROUTE_PATHS.settingsApiAccess}
            className={METASTORE_WARNING_LINK_CLASSES}
          >
            Manage scopes
          </Link>
        </div>
      )}
      {open && (
        <div className={METASTORE_DROPDOWN_PANEL_CLASSES}>
          <div className={METASTORE_DROPDOWN_SEARCH_CLASSES}>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search namespaces"
              className={METASTORE_DROPDOWN_SEARCH_INPUT_CLASSES}
              autoFocus
            />
            {loading && <Spinner size="xs" />}
          </div>
          <div className="max-h-72 overflow-y-auto px-2 py-3 text-sm">
            {hasMatchingOptions ? (
              <div className="flex flex-col gap-3">
                {filteredFavorites.length > 0 && (
                  <section>
                    <header className={METASTORE_DROPDOWN_SECTION_HEADER_CLASSES}>
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
                    <header className={METASTORE_DROPDOWN_SECTION_HEADER_CLASSES}>
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
                      <header className={METASTORE_DROPDOWN_SECTION_HEADER_CLASSES}>
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
              <div className={METASTORE_DROPDOWN_EMPTY_TEXT_CLASSES}>
                No namespaces found. Adjust your search or add manually below.
              </div>
            )}
            {manualEntryCandidate && (
              <div className={METASTORE_MANUAL_ENTRY_CONTAINER_CLASSES}>
                <button
                  type="button"
                  className={METASTORE_MANUAL_ENTRY_BUTTON_CLASSES}
                  onClick={() => handleSelect(manualEntryCandidate.name)}
                >
                  <span>
                    Use namespace <strong>{manualEntryCandidate.name}</strong>
                  </span>
                  <span className={METASTORE_OPTION_SECONDARY_TEXT_CLASSES}>Enter</span>
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
  onToggleFavorite: (event: ReactMouseEvent<HTMLButtonElement>, name: string) => void;
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

  const selectionClasses = classNames(
    METASTORE_OPTION_BUTTON_BASE_CLASSES,
    authorized ? METASTORE_OPTION_BUTTON_AUTHORIZED_CLASSES : METASTORE_OPTION_BUTTON_DISABLED_CLASSES,
    isActive && authorized ? METASTORE_OPTION_BUTTON_ACTIVE_CLASSES : undefined
  );

  return (
    <li>
      <div className="flex w-full items-start gap-3">
        <button type="button" onClick={handleClick} className={selectionClasses} disabled={!authorized}>
          <div className="flex items-center gap-2">
            <span className="font-weight-semibold text-primary">{name}</span>
            {isActive && authorized && (
              <span className={METASTORE_OPTION_BADGE_ACTIVE_CLASSES}>
                Active
              </span>
            )}
          </div>
          {authorized ? (
            secondary ? <span className={METASTORE_OPTION_SECONDARY_TEXT_CLASSES}>{secondary}</span> : null
          ) : (
            <span className={METASTORE_OPTION_WARNING_TEXT_CLASSES}>
              No access. Request additional scopes from settings.
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={(event) => onToggleFavorite(event, name)}
          className={classNames(
            METASTORE_FAVORITE_BUTTON_BASE_CLASSES,
            isFavorite ? METASTORE_FAVORITE_BUTTON_ACTIVE_CLASSES : undefined
          )}
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
