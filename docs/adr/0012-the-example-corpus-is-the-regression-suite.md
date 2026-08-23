# The example corpus is the regression suite

This work replaces the editor, every component, the stylesheet, the renderer
layer and the deployment target at once. The build already renders every example
in `src/examples/catalog/` strictly and fails on a bad one. We decided to extend
that into the primary safety net: every example renders through its chosen path
and is compared against a committed baseline, with differences surfaced as
images in the pull request.

It is the highest-value test asset the project already owns, and it is the only
thing that can tell us a WASM renderer produces subtly different output from the
Kroki path it replaced.
