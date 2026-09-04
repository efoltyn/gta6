/* DESERT WARLORD — THE MULTIPLAYER BUTTON, ON A PHONE.

   THE REPORT (owner): "think about openfront.io mixed with agar.io
   multiplayer to improve multiplayer make it work and make it real".

   WHAT IT DID. The deployed build — https://efoltyn.github.io/gta6/ — is a
   static file host. warnet.js built `wss://<location.host>/ws` and opened
   it, which on that host is `wss://efoltyn.github.io/ws`: an address that
   has never existed and never will. So MULTIPLAYER on the link this game
   actually ships behind opened a card with three fields, two of which were
   wrong (a server url nothing answers on, and a seed the other player also
   has to type), and RIDE OUT failed. The failure text then told a person
   holding a phone to run `node server/server.js`. Nobody has ever played
   this multiplayer from the deployed link, because it could not be played.

   AFTER. HOST A ROOM turns your own browser into the room (src/net/rooms.js
   runs server/server.js's protocol over WebRTC) and puts a four-character
   code on the screen with a share link and a live roster. JOIN A ROOM takes
   the four characters. The `?room=CODE` share link joins on open. The relay
   is still there for anyone who runs one — it is the advanced line now.

   THE BEFORE IS THE DEPLOYED BUILD, which is the only honest baseline for a
   claim about what a player sees, and iPhone 16 portrait because that is the
   device the code has to be read off and typed into.

     ba warlord-lobby
     ba warlord-lobby --before https://efoltyn.github.io/gta6/

   THE THIRD SUBJECT NEEDS THE INTERNET on the after side: opening a room
   exchanges two SDP blobs through PeerJS's public broker. Without it that
   subject photographs the game's own error text — which is itself the check
   that the error text is now true (it must not say "run a node server").
*/

const subjects = [
  { id: "menu", label: "The title card",
    focus: "Both sides: RIDE OUT, CONTINUE, MULTIPLAYER. Nothing here changed — it is the frame of reference for the two screens that did." },
  { id: "lobby", label: "MULTIPLAYER — what the button opens",
    focus: "BEFORE: three fields. YOUR NAME, a SERVER url pre-filled with wss://efoltyn.github.io/ws (a socket that has never existed on a static host), and a SEED the other player has to be told separately. AFTER: your name, and the two verbs a person actually has — HOST A ROOM, JOIN A ROOM — with the relay demoted to a one-line advanced link." },
  { id: "room", label: "A room, with a code on it",
    focus: "AFTER: the room is this browser. Four characters big enough to read across a room, a share link (navigator.share on a phone), the roster filling as people arrive, and one line saying where the room lives. BEFORE: RIDE OUT opened a socket to a file host, so this is the failure — and the failure told you to run `node server/server.js`." },
];

async function stageLobby(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.warlord) return { ok: false, err: "no CBZ.warlord" };
  const W = CBZ.warlord;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(150);
    }
    return false;
  };
  const q = (sel) => document.querySelector(sel);
  const click = (sel) => { const n = q(sel); if (n) { n.click(); return true; } return false; };

  const sub = input.subject;

  /* EVERY SUBJECT STARTS FROM THE MENU. The tool photographs subjects in one
     browser, in order, so a card left open by the previous one would leak
     into the next — and on the before side "the previous one" is a dead
     socket still trying. W.emit("mainmenu") is the same call the BACK button
     makes, on both checkouts. */
  try { W.warnet && W.warnet.disconnect && W.warnet.disconnect(); } catch (_) {}
  try { W.emit("mainmenu"); } catch (_) {}
  await wait(250);

  let note = "";
  if (sub.id === "lobby" || sub.id === "room") {
    if (!click("#mNet")) return { ok: false, err: "no MULTIPLAYER button on the menu" };
    await until(() => q("#nHost") || q("#nGo"), 8000);
  }
  if (sub.id === "room") {
    /* THE SAME GESTURE ON BOTH CHECKOUTS: press the primary verb on the
       card the MULTIPLAYER button opened. After that is HOST A ROOM; before
       there is only RIDE OUT, which opens the socket. Whatever each build
       does next IS the subject. */
    if (q("#nHost")) { click("#nHost"); note = "HOST A ROOM"; }
    else if (q("#nGo")) { click("#nGo"); note = "RIDE OUT (the only verb the old card had)"; }
    // a code, an error, or the budget — all three are a picture worth taking
    await until(() => (q(".wl-code") && /^[A-Z0-9]{4}$/.test(q(".wl-code").textContent.trim()))
      || q(".wl-net-err"), 30000);
    await wait(400);
  }

  /* THE FIELD VALUES ARE PART OF WHAT THE PLAYER READS, and innerText does
     not contain them — the first draft of shellTalk therefore scored the old
     lobby 0 while a `wss://efoltyn.github.io/ws` sat on screen in a text box,
     which is the exact thing the metric exists to catch. */
  const text = [(document.body.innerText || "")]
    .concat([...document.querySelectorAll("input")].map((i) => i.value || ""))
    .join(" ").replace(/\s+/g, " ");
  const codeNode = q(".wl-code");
  const code = codeNode ? codeNode.textContent.trim() : "";
  const metrics = {
    roomCode: /^[A-Z0-9]{4}$/.test(code) ? 1 : 0,
    shareLink: q("#nShare") ? 1 : 0,
    /* THE ONE THAT NAMES THE BUG. A shell command or a raw socket url on a
       screen a phone user is looking at is a dead end, whether it arrives as
       a pre-filled field or as an error message. */
    shellTalk: /server\.js|node server|wss?:\/\//i.test(text) ? 1 : 0,
    fields: document.querySelectorAll(".wl-net-f input").length,
    verbs: document.querySelectorAll(".wl-btn").length,
    roster: document.querySelectorAll(".wl-net-p").length,
  };
  return { ok: true, metrics, note: note + (code ? " · code " + code : "") };
}

export default {
  id: "warlord-lobby",
  title: "Desert Warlord: the multiplayer button, on a phone",
  description:
    "The deployed build's MULTIPLAYER opened a socket to a static file host and told the player to run " +
    "a node server. Now it opens a room in their own browser, with a four-character code and a share link.",
  page: "games/warlord.html",
  urlParams: { sound: "off", weather: "off" },
  devices: ["iphone-16"],
  orientations: ["portrait"],
  readyExpression: "!!(window.__warlordReady && window.CBZ && window.CBZ.warlord && window.CBZ.warlord.warnet)",
  stageTimeoutMs: 240000,
  /* THE BEFORE SIDE THROWS, AND THAT IS THE SUBJECT. On the deployed build
     the socket to the file host fails, net.js fires _offline, and warnet.js's
     goOffline() calls closeFallback() — a function deleted with the fallback
     block months ago and left behind as a live call. So every disconnect on
     main is a ReferenceError. It is fixed on the after side; here it is
     declared expected so the comparison is measured rather than voided.
     (ba's web adapter grew `allowErrors` for this — an allow-list, so any
     OTHER error still fails the subject.) */
  allowErrors: ["closeFallback is not defined"],
  beforeLabel: "BEFORE · the deployed build — a socket to a file host",
  afterLabel: "AFTER · a room, a code, a link",
  pairNote: "iPhone 16 portrait · the deployed build against this checkout · the same three taps",
  defaultFocus: "Two phones and no server: can a player get from the title card to a room somebody else can join?",
  method:
    "The same three gestures on both builds, in one browser each: the title card; MULTIPLAYER; then the " +
    "primary verb on whatever card that opened (HOST A ROOM after, RIDE OUT before — the old card had no " +
    "other). Each subject resets to the menu first through W.emit(\"mainmenu\"), the same call the BACK " +
    "button makes, so a dead socket from the previous subject cannot leak into the next.",
  metricsNote:
    "shellTalk is the bug in one number: does the screen a phone user is looking at contain a shell command " +
    "or a raw ws:// address? Before it does on both the lobby (a pre-filled wss:// field) and the failure " +
    "(`node server/server.js`); after it does not, anywhere. roomCode and shareLink are the two things that " +
    "have to exist for a second person to get in at all. fields counts text inputs — three before, one after.",
  metrics: {
    roomCode: { label: "A four-character room code on screen", unit: "0/1", better: "higher" },
    shareLink: { label: "A share link the host can send", unit: "0/1", better: "higher" },
    shellTalk: { label: "Shell commands or raw ws:// urls shown to the player", unit: "0/1", better: "lower" },
    fields: { label: "Text fields to fill in", unit: "fields", better: "lower" },
    verbs: { label: "Buttons on the card", unit: "buttons" },
    roster: { label: "Warlords listed in the room", unit: "rows", better: "higher" },
  },
  subjects,
  stage: stageLobby,
};
