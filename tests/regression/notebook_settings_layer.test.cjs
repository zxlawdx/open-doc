const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('fullscreen code notebook stays below the app settings modal', () => {
  const notebook = fs.readFileSync('apps/home/static/css/workbook_v2.css', 'utf8');
  const app = fs.readFileSync('apps/home/static/css/main.css', 'utf8');
  const rules = notebook.match(/\.open-doc \[data-code-split\]\.code-notebook-full>\.workbook-sidebar:not\(\[hidden\]\)\s*\{([^}]+)\}/);
  assert.ok(rules, 'fullscreen notebook sidebar rule exists');
  const paneZ = Number(rules[1].match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(paneZ), 'fullscreen notebook z-index is numeric');
  const dialogRule = app.match(/\.open-doc \.modal-backdrop\s*\{([^}]+)\}/);
  assert.ok(dialogRule, 'application dialog rule exists');
  const dialogToken = dialogRule[1].match(/z-index:\s*var\((--[\w-]+)\)/)?.[1];
  assert.equal(dialogToken, '--z-dialog');
  const dialogZ = Number(app.match(/--z-dialog:\s*(\d+)/)?.[1]);
  assert.ok(dialogZ > paneZ, 'settings dialog must be clickable above a fullscreen notebook');
});
