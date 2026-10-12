// Politique Trusted Types (audit 2026-10-12) : node --test scripts/trustedTypes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeHtml, safeScriptUrl } from '../src/lib/trustedTypes.ts'
import hljs from 'highlight.js'

test('HTML : texte et coloration highlight.js seulement', () => {
  assert.equal(safeHtml(' '), true)
  assert.equal(safeHtml('a &gt; b'), true)
  for (const [code, lang] of [['const x = "<img src=x onerror=alert(1)>"', 'js'], ['<div onclick="x()">&amp;</div>', 'html'], ['class A extends B { f() { return 1 } }', 'ts'], ['SELECT * FROM t -- </span><script>', 'sql']]) {
    const out = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    assert.equal(safeHtml(out), true, out)
  }
  for (const bad of ['<img src=x onerror=alert(1)>', '<span class="hljs-x" onclick="a()">', '<script></script>', '<span class="x">', '<svg onload=alert(1)>', '<a href="javascript:1">', '<span class="hljs-keyword"><b>x</b></span>']) {
    assert.equal(safeHtml(bad), false, bad)
  }
})

test('adresses de script : notre origine, blob: de notre origine, API YouTube', () => {
  const o = 'https://forgechat.example'
  for (const ok of ['/assets/a.js', 'https://forgechat.example/mediapipe/x.js', 'blob:https://forgechat.example/1234', 'https://www.youtube.com/iframe_api']) {
    assert.equal(safeScriptUrl(ok, o), true, ok)
  }
  for (const ko of ['https://evil.example/x.js', 'blob:https://evil.example/1', 'data:text/javascript,alert(1)', 'javascript:alert(1)', 'https://www.youtube.com/other.js', '//evil.example/x.js']) {
    assert.equal(safeScriptUrl(ko, o), false, ko)
  }
})
