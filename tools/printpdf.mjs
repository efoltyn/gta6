/* tools/printpdf.mjs — print a local HTML file to a PDF with a fresh headless
   Chrome (--print-to-pdf, not CDP printToPDF: tools/visual-compare.mjs found
   CDP printing can stall after a long WebGL session). Shared by
   tools/catalogue.mjs and tools/model-census.mjs.

   HARNESS TRAP: this headless print writes the PDF and then does not always
   exit (measured: PDF done in seconds, process alive 10+ min later). Wait for
   the file to land and stop growing, then end the process group ourselves. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CHROME } from "./testbus/browser.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function printHtmlToPdf(html, pdf, { workDir = path.dirname(html), budgetMs = 15000, timeoutMs = 300e3 } = {}) {
  mkdirSync(workDir, { recursive: true });
  const tmp = path.join(workDir, "_print-" + path.basename(pdf));
  rmSync(tmp, { force: true });
  const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", `--virtual-time-budget=${budgetMs}`,
    `--user-data-dir=${path.join(workDir, "profile")}`, `--print-to-pdf=${tmp}`, pathToFileURL(html).href],
  { stdio: "ignore", detached: true });
  let exited = false; ch.on("exit", () => { exited = true; });
  const t0 = Date.now();
  let last = -1, same = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(500);
    const sz = existsSync(tmp) ? statSync(tmp).size : -1;
    if (sz > 0 && sz === last) { if (++same >= 4) break; } else same = 0;
    last = sz;
    if (exited && sz <= 0) break;
  }
  try { process.kill(-ch.pid, "SIGKILL"); } catch (_) {}
  if (!existsSync(tmp) || statSync(tmp).size === 0) throw new Error("Chrome wrote no PDF");
  mkdirSync(path.dirname(pdf), { recursive: true });
  writeFileSync(pdf, readFileSync(tmp));
  rmSync(tmp, { force: true });
  return pdf;
}
