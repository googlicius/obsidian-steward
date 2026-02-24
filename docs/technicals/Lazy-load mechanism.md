# Lazy-load mechanism for fast startup

## Overview

To keep plugin startup around ~300ms, we avoid constructing non-critical dependencies at boot time.

Instead of eagerly creating everything, we:

- declare references for all optional dependencies up front (around 15 services and 30+ tool handlers),
- instantiate each dependency only when it is first accessed,
- reuse the same instance for subsequent calls.

This keeps initialization work small while still giving full functionality during runtime.

## How it works

```mermaid
flowchart LR
    A[Plugin starts] --> B[Only core services are initialized]
    B --> C[Lazy references stay undefined]
    C --> D[Feature is requested]
    D --> E[Getter creates the dependency once]
    E --> F[Same instance is reused]
```

### Service-level lazy loading

```ts
// main.ts (simplified)
_searchService: SearchService;

get searchService(): SearchService {
  if (!this._searchService) {
    this._searchService = SearchService.getInstance(this);
  }
  return this._searchService;
}
```

### Handler-level lazy loading

```ts
// SuperAgentHandlers.ts (simplified)
private _vaultCreate: handlers.VaultCreate;

public get vaultCreate(): handlers.VaultCreate {
  if (!this._vaultCreate) {
    this._vaultCreate = new handlers.VaultCreate(this.getAgent());
  }
  return this._vaultCreate;
}
```

## Key decisions

- **Cache after first access**: avoids repeated construction cost and keeps behavior predictable.
- **Getter-based access**: enforces a single path for creation and retrieval.
- **Pay-as-you-go startup**: boot time stays low because unused features are not initialized.

## Important notes

- Add new services/handlers using the same lazy getter pattern to keep startup performance stable.
- Avoid directly constructing heavy dependencies in startup lifecycle hooks unless strictly required.
