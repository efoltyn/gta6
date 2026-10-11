# Real gang names — local change

User request: replace confusing racial “car” labels with real gang names.

Updated the canonical label and spoken-phrase catalogue in `src/systems/prisoncars.js`:

| Previous label | New label |
| --- | --- |
| Southsiders | Sureños |
| Black car | Black Guerrilla Family |
| White car | Aryan Brotherhood |
| Paisas | Border Brothers |
| Asian car | Asian Boyz |
| Others | Independents |

`src/systems/interact.js` now describes an inmate without active gang membership as Independent. Internal faction IDs and the existing heritage-based yard partition remain. This is a naming pass over the game's simplified factions, not a full redesign of gang membership or an assertion that everyone of a heritage belongs to that gang.

Verified names against primary sources:

- [CDCR Operations Manual, designated prison gangs](https://www.cdcr.ca.gov/regulations/wp-content/uploads/sites/171/2026/03/Annual_DOM.pdf): Aryan Brotherhood and Black Guerrilla Family.
- [DOJ Northern California gang analysis](https://www.justice.gov/archive/ndic/pubs40/40395/dtos.htm): Border Brothers and Asian Boyz.
- [DOJ Sureños case](https://www.justice.gov/usao-ndca/pr/ten-alleged-members-surenos-gang-charged-murder-and-related-crimes): Sureños.

Validation: `node tools/prison-cars-check.mjs` passed 77/77 checks; `node tools/interact-verbs-check.mjs` passed 145 contexts. JavaScript syntax checks passed for both gameplay files and the visual preset.

Added gang-white and gang-black identity scenes to `tools/visual-presets/interaction-prison.mjs`. Attempted a baseline capture before modifying gameplay, but the harness could not bind its local server under the current restricted permissions (`no free port found in 8700..9200`). No matched screenshots or PDF were produced for this change. Longer labels remain visually unverified. Local-only, not deployed.

## Solution for the wider interaction problem

Keep no more than three choices. Show fewer when there is no meaningful decision. Derive requests from actual debts, stolen possessions, injuries and conflicts; retire the random-favor fallback. Use visible/reachable targets and bind a press to the actor and verb it displayed. Separate recruiting a companion from arranging escape assistance: a friend should help perform an escape, rather than switch the game to won because reputation reached a number. Clarify immediate purchases with Buy. Give each gang specific people, relationships and ongoing business so its name represents behavior.

Those broader interaction changes are proposed; this pass implements the naming request only.
