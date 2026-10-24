# Open Doc architecture

```text
Vela / WebView
   |
Presentation: bridge.py, api.py, views/templates/static
   |
Application: DocumentApplication + ApplicationContext
   |
Domain: document concepts and model invariants
   |
Infrastructure: workspace/filesystem and format/native adapters
```

## Composition root

`config/wsgi.py` configures one `ApplicationContext` and then creates `VelaApp`. It no longer changes Bottle globals. Transport size is configuration (`API.max_body_size`).

## Thin boundaries

`bridge.py` owns native UI concerns such as file pickers and delegates document operations to `DocumentApplication`. `api.py` owns HTTP authentication/status mapping and delegates document rules to the same facade.

The historical `apps.open_doc.services.container` path remains as a compatibility shim while existing services/tests migrate to `apps.open_doc.application.context`.

## Domain and document model

The domain must not import Vela, Bottle or WebView. The existing `document_model/` package remains the production serialization model; new framework-independent value objects live under `domain/`. Migration is incremental to avoid breaking DOCX/PDF round trips.

## Infrastructure

Filesystem path policy is centralized in `infrastructure/workspace.py`. Import/export implementations remain technology adapters and may depend on filesystem, PDF/DOCX libraries and OS capabilities.

## Tests

`tests/test_architecture.py` validates the dependency direction with AST import scanning. Existing DOCX round-trip, fixed document, handwriting and frontend tests remain the behavioral safety net.
