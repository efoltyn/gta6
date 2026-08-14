/*
  intro-screen.mjs — the title card, photographed as a SHAPE.

  Every other preset in this directory poses a model and holds the camera
  still. This one holds no camera at all: the subject is the DOM, and the
  variable is the viewport. A title screen is right at 393pt and wrong at
  852pt, so the run is a matrix of device frames (visual-compare --frames)
  and the metrics answer the four questions a player's first ten seconds ask:

    fillPct        how much of the screen the card actually uses
    playVisible    can I start the game without scrolling
    scrollsToPlay  if not, how many screenfuls away is the button
    wordmarkTop    is the game's NAME the first thing on screen, or the last

  Those numbers are why this preset exists. "The intro looks better" is an
  opinion; "34% of the screen was empty and PLAY was 2.2 screens down" is a
  measurement, and it either moved or it did not.
*/

export default {
  id: "intro-screen",
  title: "The title card, across phones and tablets",
  description:
    "The first screen of the game at five device frames. Before is the deployed build; after is the current checkout. " +
    "No world is built and no camera moves — the only variable is the viewport and the markup inside it.",
  // Deliberately mixed: two phone widths, the same phone rotated, a tablet in
  // landscape, and a laptop. Landscape phone is the shape that was broken.
  frameList: [
    "iphone-se:portrait",
    "iphone-16:portrait",
    "iphone-16:landscape",
    "ipad-mini:landscape",
    "laptop",
  ],
  // The title screen is DOM, but state.js wires the pickers after boot and
  // sets the active origin — waiting for that avoids photographing a card
  // whose buttons are not live yet.
  readyExpression:
    "document.querySelector('#title:not(.hidden) #playBtn') && document.querySelector('.origin-btn.active')",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same build, same boot, same device frame — the markup is the variable",
  method:
    "Each frame is a real Chrome device emulation (viewport, pixel ratio, touch, user agent, screen orientation) " +
    "applied BEFORE navigation, because body.touch and the control layout are decided once at boot. " +
    "Chrome cannot emulate safe-area insets, so notch and home-bar overlap are not visible here.",
  defaultFocus:
    "Is the game's name first, is PLAY reachable without scrolling, and is the screen's width used?",
  subjects: [
    {
      id: "city-title",
      label: "Gang Life title",
      mode: "city",
      focus: "The default screen. Wordmark, role picker, PLAY — how much of it lands above the fold?",
    },
    {
      id: "escape-title",
      label: "Prison Escape title",
      mode: "escape",
      focus: "The other mode's card must survive the reshuffle untouched.",
    },
  ],
  metrics: {
    fillPct: { label: "Screen width used by the card", unit: "%", better: "higher" },
    playVisible: { label: "PLAY visible without scrolling", unit: "1=yes", better: "higher" },
    scrollsToPlay: { label: "Screenfuls of scrolling to reach PLAY", unit: "screens", better: "lower" },
    wordmarkTop: { label: "Wordmark position down the card", unit: "% of content", better: "lower" },
    contentOverflow: { label: "Content below the card's visible box", unit: "px", better: "lower" },
    visibleKeycaps: { label: "Keyboard key caps shown on a touch device", unit: "caps", better: "lower" },
  },
  metricsNote:
    "Measured live in the page at each device frame. fillPct is the card's border box against the viewport width; " +
    "scrollsToPlay is the distance from the card's scroll top to the bottom of #playBtn, in viewport heights.",

  // A named function expression, not a shorthand method: the runner ships this
  // to the page via stage.toString(), and a shorthand method does not survive
  // being wrapped in parentheses.
  stage: async function stageIntroScreen(input) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const mode = input.subject.mode || "city";
    const modeButton = document.querySelector('.mode-btn[data-mode="' + mode + '"]');
    if (!modeButton) return { ok: false, error: 'no .mode-btn[data-mode="' + mode + '"]' };
    modeButton.click();
    await sleep(220);

    const card = document.querySelector("#title .card-box");
    if (!card) return { ok: false, error: "no #title .card-box" };
    // Always photograph the FIRST screen. A card that remembers a scroll
    // position from a previous subject would flatter or slander the layout.
    card.scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    await sleep(160);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cardRect = card.getBoundingClientRect();
    const play = document.getElementById("playBtn");
    const playRect = play ? play.getBoundingClientRect() : null;
    // The visible wordmark belongs to whichever mode card is on screen.
    const logo = Array.from(document.querySelectorAll("#title .logo"))
      .find((node) => node.getBoundingClientRect().height > 0) || null;

    // "Visible" means inside the viewport AND inside the card's own scrollport,
    // because #title .card-box is itself a scroller — an element can sit in the
    // viewport band and still be clipped by the card above or below it.
    const isVisible = (rect) => !!rect
      && rect.bottom <= viewportHeight + 1 && rect.top >= -1
      && rect.bottom <= cardRect.bottom + 1 && rect.top >= cardRect.top - 1;

    const contentOverflow = Math.max(0, card.scrollHeight - card.clientHeight);
    // Distance the player must travel to put PLAY on screen, in screenfuls.
    let scrollsToPlay = 0;
    if (playRect && !isVisible(playRect)) {
      const playBottomInContent = (playRect.bottom - cardRect.top) + card.scrollTop;
      scrollsToPlay = Math.max(0, (playBottomInContent - card.clientHeight) / Math.max(1, card.clientHeight));
    }
    const wordmarkTop = logo
      ? ((logo.getBoundingClientRect().top - cardRect.top + card.scrollTop) / Math.max(1, card.scrollHeight)) * 100
      : 100;

    const touch = document.body.classList.contains("touch");
    const visibleKeycaps = !touch ? 0 : Array.from(document.querySelectorAll("#title .kbd, #title .keycap"))
      .filter((node) => {
        // A cap folded inside a collapsed <details> is not on the player's
        // screen, and headless Chrome still hands back a laid-out box for it —
        // which counted nine phantom caps in the first run of this preset.
        if (node.closest("details:not([open])")) return false;
        if (typeof node.checkVisibility === "function"
          && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length;

    return {
      ok: true,
      mode,
      frame: input.frame ? input.frame.id : null,
      touch,
      metrics: {
        fillPct: (cardRect.width / Math.max(1, viewportWidth)) * 100,
        playVisible: isVisible(playRect) ? 1 : 0,
        scrollsToPlay,
        wordmarkTop,
        contentOverflow,
        visibleKeycaps,
      },
    };
  },
};
