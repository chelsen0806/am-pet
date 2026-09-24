#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const framesDir = path.join(__dirname, '..', 'src', 'assets', 'frames');
const states = ['idle', 'jump', 'shake', 'shake2', 'shy_shake'];

const lines = ['window.AM_PET_FRAMES = {'];
for (const state of states) {
  const dir = path.join(framesDir, state);
  const count = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^\d+\.png$/i.test(f)).length
    : 0;
  const comma = state === states[states.length - 1] ? '' : ',';
  lines.push(`  ${state}: ${count}${comma}`);
}
lines.push('};', '');

fs.writeFileSync(path.join(framesDir, 'manifest.js'), lines.join('\n'));
console.log(`Wrote ${path.join(framesDir, 'manifest.js')}`);
