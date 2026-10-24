# ADR 0002: isolate legacy Vela transport compatibility

## Status
Accepted temporarily.

## Context
Open Doc accepts rich document payloads larger than Bottle's historical in-memory default. The currently pinned Vela revision does not yet consume `API.max_body_size`, although newer Vela work does.

Previously `config/wsgi.py` imported and mutated `bottle.BaseRequest` directly. Removing that mutation before upgrading the framework caused the large-document regression test to return HTTP 413.

## Decision
Keep the compatibility mutation in `apps/open_doc/infrastructure/vela_compat.py`. `config/settings.py` remains the source of the configured limit; the composition root calls the adapter but does not know Bottle internals.

## Removal condition
Delete this adapter when Open Doc updates its Vela pin to a revision that natively honors `API.max_body_size`, after the large-document integration test passes without the adapter.
