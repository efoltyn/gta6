/* ba.config.mjs — what "before/after" means for THIS repo.

   Finding this file is how `ba` decides where the project root is, so every
   relative path below resolves against this directory and `ba` behaves the
   same from any subdirectory.

   These four facts are all that used to be hardcoded inside the tool:

     presets   the 60-odd visual recipes that already exist here, kept where
               they are — extracting the tool must not move a single preset,
               and the preset contract is unchanged.
     baseline  the deployed build. A preset that declares its own
               defaultBefore (usually "local", for a flag A/B against this
               same checkout) overrides this, and that is the stronger claim:
               the deployed build differs by every commit since deploy.
     serve     builtin. ba's own static server does the three things that
               matter — no-store on every response, .wasm pinned to
               application/wasm, HTTP/1.1 keep-alive for the ~300 file
               requests a load fires — so python is no longer needed to take
               a screenshot.
     out       the existing report directory, already gitignored, so old runs
               and new ones sit together.
*/

export default {
  presets: "./tools/visual-presets",
  baseline: "https://efoltyn.github.io/gta6/",
  serve: "builtin",
  out: "artifacts/visual-comparisons",
  browser: null,
};
