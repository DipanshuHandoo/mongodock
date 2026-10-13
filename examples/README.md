# Phase 1 examples

`basic.mjs` normalizes a single database setup. `full-tour.mjs` covers named
configuration, plugin-triggered retry normalization, explicit disable, and safe
errors. Neither opens a network connection or claims service operations exist.

Run `npm run build` then `npm run test:package` to exercise these examples
against an installed tarball. Examples import the public package name and
assert actual outputs. They remain in the repository, not the npm artifact.
