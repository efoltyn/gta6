#!/usr/bin/env node
/* tools/president-check.mjs: the check lives in tools/probes/president.mjs.
   This runs it the OLD way (its own Chrome, its own boot). Builders: submit it
   to the test bus instead (tools/testbus/README.md); it shares one warm boot.
     node tools/president-check.mjs [--seed N] [--quick] [--motorcade] */
import { runStandalone } from "./testbus/standalone.mjs";
await runStandalone(new URL("./probes/president.mjs", import.meta.url), process.argv.slice(2));
