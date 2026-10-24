# ADR 0001: thin HTTP and WebView boundaries

## Status
Accepted.

## Context
Open Doc had document format decisions, workspace path validation and import/export orchestration directly in both `api.py` and `bridge.py`. The same application behavior therefore depended on whether it was called by HTTP or WebView.

## Decision
Both boundaries delegate to `DocumentApplication`. Native file pickers stay in the Bridge; HTTP status/authentication stay in the API controller. Filesystem path policy moves to an infrastructure adapter.

## Consequences
Document operations are testable without Vela/WebView, and adding another presentation surface does not require copying format rules. Existing service modules remain intact to protect document round-trip behavior.
