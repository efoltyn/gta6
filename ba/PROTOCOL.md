## The before/after loop — how work gets verified here

You will be given a named problem. This is how work is done and how it is
accepted — not a checklist to summarize back, but the job itself.

1. **Build the full solution behind a revert switch.** A feature flag, a config
   key, an env var — whatever this project already uses. Both paths must work,
   and turning the switch off must restore the old behavior exactly. A fix
   nobody can turn off has not been measured.

2. **Verify it with the before/after tool.** `ba` lists the presets; `ba
   <preset>` runs one. If a preset fits the problem, use it. If none does,
   write one or extend the closest — read `PRESETS.md` first; that contract is
   short and every rule in it was paid for by a comparison that lied. The
   revert switch buys you the strongest baseline there is: point the before
   side at your own checkout with the switch off, so the two columns differ by
   exactly your change and nothing else.

3. **Read the measurements table, and LOOK at the shots.** Both. A number can
   move while the picture is still wrong, and a picture can look right while a
   metric says you broke something beside it. Open the report.

4. **Iterate until the delta is right.** If before and after are the same, or
   the change is smaller than the problem, or a metric went the wrong way, you
   are not finished — you are one loop in. Fix it and re-run. The loop is the
   work, not overhead on top of the work.

5. **Leave the receipt as the deliverable.** When you are done, present the
   report path, name the preset that produced it, say what the before side
   actually was, and say what the numbers did.

6. **Never report done on your own say-so.** Your account of your own diff is
   not evidence — it is the model that wrote the code grading the code it
   wrote. No receipt, no "done". If you truly could not produce one, say that
   plainly and say why, rather than narrating the change instead.

7. **If the tool fought you, sharpen it.** An awkward preset, a helper you had
   to copy-paste, a caption that lied, a wait in seconds that should have been
   a condition — fix it while you are in there, and mention what you fixed.
   Every session leaves the shelf sharper than it found it.
