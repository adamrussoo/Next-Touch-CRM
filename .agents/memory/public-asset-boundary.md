---
name: Public asset boundary
description: Why local web servers for this imported CRM must never expose the workspace root.
---

Serve only explicit frontend assets and the minimum required data files. Never use the repository root as a general static directory.

**Why:** The imported package contains internal operational documentation, automation prompts, archives, and repository metadata alongside the public dashboard files. A broad static root would silently make those materials downloadable.

**How to apply:** When adding routes, file downloads, or a different web framework, keep a strict public-directory or route allowlist and verify representative internal paths return 404 before shipping.