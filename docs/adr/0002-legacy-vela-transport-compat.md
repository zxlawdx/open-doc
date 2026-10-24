# ADR 0002: legacy Vela transport compatibility

## Status
Superseded.

## Context
Open Doc accepts rich document payloads larger than Bottle's historical in-memory default. An older pinned Vela revision did not consume `API.max_body_size`, so Open Doc temporarily isolated a `BaseRequest.MEMFILE_MAX` mutation in `apps/open_doc/infrastructure/vela_compat.py`.

## Previous decision
Keep the compatibility mutation at the infrastructure boundary instead of leaking Bottle internals into `config/wsgi.py`, application or domain.

## Superseding decision
Open Doc now pins a Vela revision that natively honors `API["max_body_size"]`. The compatibility adapter and its dedicated tests are removed; `config/settings.py` is the only source of the request-body policy.

## Consequence
The application no longer mutates Bottle transport globals. Large-document integration tests remain the regression gate for the native Vela behavior.
