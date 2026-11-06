// Compile the actual product component into an existing-style browser test harness.
// No API, auth mock, source-data mutation or device connection is installed.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..'),hub=path.join(repo,'mira-hub'),out=path.resolve(process.argv[2]??'/tmp/cv101-walkthrough-preview');
const require=createRequire(path.join(hub,'package.json'));
fs.mkdirSync(out,{recursive:true});
await require('esbuild').build({entryPoints:[path.join(here,'browser.tsx')],outfile:path.join(out,'browser.js'),bundle:true,platform:'browser',absWorkingDir:hub,tsconfig:path.join(hub,'tsconfig.json'),jsx:'automatic',nodePaths:[path.join(hub,'node_modules')],define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_API_BASE':'"/hub"','process.env.OAUTH_BASE_PATH':'""','process.env.NEXT_PUBLIC_MAX_UPLOAD_MB':'"50"'}});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CV-101 walkthrough · component test preview</title><link rel="stylesheet" href="browser.css"><style>html,body,#root{margin:0;min-height:100%;font-family:var(--fl-font);background:var(--fl-surface);color:var(--fl-ink)}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="browser.js"></script></body></html>');
console.log(out);
