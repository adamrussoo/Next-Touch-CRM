---
name: Mockup preview recovery
description: How to restore a canvas mockup when its preview route falls through to the main app.
---

If a live canvas mockup shows the main app's 404 page, first verify that its isolated preview workflow exists and that the artifact has installed dependencies. An existing directory containing only a component source is not a usable sandbox; create a fresh mockup artifact, preserve the source, install that artifact's dependencies, and re-home the affected frame to the fresh preview route.

**Why:** Canvas frames can outlive the artifact registration or workflow that originally served them, leaving a valid-looking URL that resolves to the wrong server.

**How to apply:** Keep the original production app untouched, use a new artifact slug when the old directory collides, update only the selected frame's URL and component path, then confirm the preview route and workflow logs before presenting the frame.