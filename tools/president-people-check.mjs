#!/usr/bin/env node
/* tools/president-people-check.mjs: the check lives in tools/probes/president-people.mjs.
   This runs it the OLD way (its own Chrome, its own boot). Builders: submit it
   to the test bus instead (tools/testbus/README.md); it shares one warm boot.
     node tools/president-people-check.mjs [--seed N] [-v] */
import { runStandalone } from "./testbus/standalone.mjs";
await runStandalone(new URL("./probes/president-people.mjs", import.meta.url), process.argv.slice(2));
