/* ============================================================
   src/integrations/index.js — module-world integrations registry.

   bootstrap.js imports this ONCE (side-effect import); each line below is
   one vendored/OSS component wired through the O1 shim's registerModule()
   convention (see src/integrations/grass.js for the annotated template).

   MODULE WORLD ONLY (see bootstrap.js's own file header for the full
   contract): a dumb static file server (`python3 -m http.server`) never
   loads bootstrap.js, so it never loads this file or anything it imports
   either — no integrations run there, by design. That's the intended
   direction of travel for the O wave (BUILD-PLAN.md Stage O), not a gap.
============================================================ */
import "./grass.js";
