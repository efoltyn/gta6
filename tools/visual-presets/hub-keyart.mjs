/* hub-keyart.mjs — the main menu's card art, shot by the engine.

   The title hub (index.html #title) shows one piece of key art per game: the
   hero behind the selected game, and the tile in the game rail. Those images
   are NOT painted — they are the store-cover scenes the *-product presets
   already stage with each game's own verbs, photographed WITHOUT the title
   overlay (the hub sets its own type over them, so a baked-in wordmark would
   print twice).

   This file is a thin wrapper, not a copy: it imports the named product
   preset and adds one initScript that hides every cover title before the page
   exists. Pick the game with an env var, the subject with --subjects:

     HUB_KEYART_GAME=city ba --preset hub-keyart --only after \
       --subjects cover-chase --width 1600 --height 900 --no-open --out DIR

   tools/hub-keyart.sh runs the whole roster and writes assets/keyart/*.jpg.
   Re-run it after any wave that changes how a game looks; the menu picks the
   new files up with no code change.

   HARNESS TRAP: the cover titles have no shared id — the kit's is #coverTitle,
   and five presets that predate the kit each name their own
   (#cityProductTitle, #prisonProductTitle, ...). The rule below matches both
   shapes. A new product preset that invents a third naming scheme will leak
   its title into the menu art: name it `<game>ProductTitle` or use the kit. */

const GAME = process.env.HUB_KEYART_GAME || "city";
const base = (await import(`./${GAME}-product.mjs`)).default;

function hideCoverTitles() {
  // visibility, not display: the kit measures the title to fit it, and a
  // display:none element measures 0 and would loop its shrink-to-fit.
  const css = '#coverTitle,#coverVignette,[id$="ProductTitle"]{visibility:hidden!important}';
  const add = function () {
    if (document.getElementById("hubKeyartNoTitle")) return;
    const s = document.createElement("style");
    s.id = "hubKeyartNoTitle";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) add();
  document.addEventListener("DOMContentLoaded", add);
}

export default {
  ...base,
  id: "hub-keyart",
  title: `Menu key art: ${base.title || GAME}`,
  description: `The ${GAME} store-cover scenes with the title overlay hidden, for the main menu's hero and game tiles.`,
  initScript: hideCoverTitles,
};
