# Prison interaction exploration — 2026-09-30

Assumption: explore the direct Prison Escape mode and propose improvements; leave gameplay unchanged.

## Evidence and limits

Read the current local interaction, economy, quest, friendship and escape owners. Inspected one current desktop capture: `/Users/elifoltyn/harness/out/gta6/prison-interaction-exploration-20260930/shots/after/f01-laptop__01-inmate-walkup.png`. Bishop's card shows Trade / Talk / Steal, identifies a Phone Charger at 7 cigs, and is compact and readable. The actor is centered while the menu is at the right edge. This is a staged current-state capture, not a before/after comparison or a normal playthrough. The capture process ended without producing the guard/mobile shots or a completed report; those views remain unverified. No gameplay edits or deployment.

## What feels generic, and what could improve it

1. **People inherit a template.** `src/systems/interact.js:298` curates a maximum of three choices, which is already sensible. But ordinary inmates get a contextual headline followed by fixed Talk / Steal. With no special role the headline is Insult. Two of a stranger's three choices are therefore hostile. Allow fewer options when little is happening; let individual circumstances earn the headline rather than filling a slot with Insult. Keep the three-option ceiling.

2. **Talk hides a random chore generator.** `src/systems/quests.js:32` generates beat-up, theft-count or cigarette-gift jobs. Victims are drawn from the roster, and the stated reason is explicitly flavor. Theft jobs count successful steals rather than delivery of a specific thing; completion checks cigarette balance or global KO history. This makes the same errand reusable across otherwise different people. Prefer requests caused by actual events: recover his stolen radio, repay a specific debt, help someone who was threatened. The existing prison-contract path already does this and should replace more of the generic fallback.

3. **Relationship progress grants implausible power.** Each completed favor adds 34 rep (`quests.js:103`). At 100, Talk calls `winGame` immediately (`quests.js:144`); the player does not have to reach the side gate. `prisonfriends.js:352` also routes Befriend through that ending when rep reaches the threshold, whereas rescue/trading-based friendship recruits a companion. Give these promises distinct outcomes. A friend can distract a guard, arrange access, or accompany you; an escape favor should still require a physical escape. A regular inmate needs a believable connection before he can arrange one.

4. **The card can address the wrong person.** `interact.js:791` selects by horizontal distance within 3.6 units. It has no facing, height, obstruction or stable-target checks, apart from the gunpoint override. The update replaces the target every frame, and clicks dispatch by option index. This creates a source-level risk of target or verb changes under a press in crowded areas. Use visible, reachable targets, retain a target briefly while engaged, and bind the press to the actor and action shown. Object prompts already have reach/obstruction and look-weight logic in `interactions.js` worth reusing.

5. **Some labels undersell what a press does.** Trade immediately spends currency and buys the displayed item (`economy.js:810`); it does not open a shop. The desktop capture does show the item and price, so this is an expectation problem rather than absent information in that shot. Consider Buy for a single-item sale. Bribe remains on clean guards, despite default phone-bridge rules making them refuse and remember the attempt (`economy.js:919`). Bent guards can exchange a known snitch's name automatically, without a name-selection step. Let the conversation establish the terms before the player commits something as consequential as a person's identity. Keep concise controls, with terms spoken by the actor.

## Strong existing direction

Preserve earned friendship from rescues and repeat trading, grudges with specific causes, debts between actual people, and speech over the speaker's head. These connect choices to remembered events. Do not add a broad dialogue tree or more simultaneous buttons just to increase apparent depth.

## Suggested order

First fix target selection and press stability. Then replace fabricated favor jobs with event-backed requests. Finally make friendship and escape assistance produce distinct physical behavior, and clarify transactional verbs. Target result: choices that make sense for this person, at this moment, with an observable consequence.
