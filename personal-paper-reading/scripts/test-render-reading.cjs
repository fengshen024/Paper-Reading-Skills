// Adapted from Xiaofeng Shi (MIT); see ../THIRD_PARTY.md.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const renderer = path.resolve(__dirname, 'render-reading.cjs');

function cleanTemp(dir) {
  const base = fs.realpathSync(os.tmpdir());
  const target = fs.realpathSync(dir);
  if (!target.startsWith(base + path.sep) || !path.basename(target).startsWith('paper-reading-')) throw new Error('Unexpected cleanup path');
  fs.rmSync(target, { recursive: true, force: true });
}

test('ordinary Chinese notes preserve code literals, title images, and folded self-checks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-personal-test-'));
  try {
    const jpeg = path.resolve(__dirname, '../examples/demo.assets/support-vectors.jpg');
    fs.copyFileSync(jpeg, path.join(dir, 'support.JPG'));
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'nested', 'paper.html');
    fs.writeFileSync(source, '# 中文笔记\n\n## 机制\n\n公式 $x+y$，解释。代码 `"$code$"` 保持原样。\n\n```python\nliteral = "$block$"\n```\n\n![示例图](support.JPG "Teaching figure")\n\n## 理解自检\n\n为什么？\n\n<details>\n<summary>参考答案</summary>\n\n按来源回答，关键条件为 $x>0$。\n\n</details>\n');
    execFileSync(process.execPath, [renderer, source, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<html lang="zh-CN">/);
    assert.match(html, /data:image\/jpeg;base64,/);
    assert.match(html, /title="Teaching figure"/);
    assert.match(html, /<code>[^<]*\$code\$[^<]*<\/code>/);
    assert.match(html, /<code class="language-python">[^<]*\$block\$/);
    assert.equal((html.match(/class="inline-math"/g) || []).length, 2);
    assert.match(html, /<details>\s*<summary>参考答案<\/summary>/);
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
    assert.match(html, /按来源回答，关键条件为 <span class="inline-math">/);
    assert.doesNotMatch(html, /src="support.JPG"|PAPER_READING_SLOT_|PAPERREADINGINLINE\d/);
  } finally { cleanTemp(dir); }
});

test('Chinese source references toggle while real links and code stay intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-chinese-source-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    fs.writeFileSync(source, '# 来源格式\n\n## 证据\n\n观察。[原文 §3.2, Eq.1]\n\n[原文链接](paper.pdf)\n\n`[原文 仅为代码]`\n');
    execFileSync(process.execPath, [renderer, source, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<span class="source-ref">\[原文 §3\.2, Eq\.1\]<\/span>/);
    assert.match(html, /<a href="paper.pdf">原文链接<\/a>/);
    assert.match(html, /<code>\[原文 仅为代码\]<\/code>/);
    assert.equal((html.match(/<span class="source-ref">/g) || []).length, 1);
  } finally { cleanTemp(dir); }
});

test('existing base64 images remain portable, and an unsupported language fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-data-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7ZQAAAABJRU5ErkJggg==';
    fs.writeFileSync(source, `# Paper\n\n## Figure\n\n![pixel](${pixel})\n`);
    execFileSync(process.execPath, [renderer, source, output]);
    assert.ok(fs.readFileSync(output, 'utf8').includes(pixel));
    fs.writeFileSync(source, '<!-- paper-reading-lang: fr -->\n# Paper\n');
    assert.throws(() => execFileSync(process.execPath, [renderer, source, output], {stdio:'pipe'}), /Unsupported reading language/);
  } finally { cleanTemp(dir); }
});

test('rendering cannot overwrite the Markdown source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-preserve-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const contents = '# Source\n\n## Mechanism\n\n$x+y$\n';
    fs.writeFileSync(source, contents);
    assert.throws(() => execFileSync(process.execPath, [renderer, source, source], {stdio:'pipe'}), /must not overwrite/);
    assert.equal(fs.readFileSync(source, 'utf8'), contents);
  } finally { cleanTemp(dir); }
});

test('inline math stays in prose, display math stays separate, and paired values share one scale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    fs.writeFileSync(source, `<!-- paper-reading-lang: zh-CN -->
# Test Paper

## 01 / Overview

\`\`\`paper-map
{"thesis":"One idea grounded in the source.","items":[{"number":"01","label":"Input","text":"A source fact.","source":"PDF p. 1"}]}
\`\`\`

**Example:** A has $x+y$, B has $z$. The result stays in one paragraph.

**Worked example:** A has $A_i$, B has $f_A=1,f_B=0.5$, and $\\lambda=4/3$ remains inline.

中文公式 $A_i$，标点与公式同行。

An observation can be read on its own.（PDF p. 3, Fig. 1）

Another observation stands alone (PDF p. 5, Fig. 2).

*原论文 Fig. 1，PDF p. 4。图示说明留在本页。*

$$x=y+z$$

\`\`\`paper-chart
{"type":"paired","title":"Example","source":"PDF p. 2","rows":[{"label":"Model A","before":60,"after":70},{"label":"Model B","before":70,"after":60}]}
\`\`\`
`);
    execFileSync(process.execPath, [renderer, source, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<strong>Example:<\/strong> A has <span class="inline-math">[\s\S]*?B has <span class="inline-math">[\s\S]*?The result stays in one paragraph\.<\/p>/);
    assert.equal((html.match(/class="inline-math"/g) || []).length, 6);
    const worked = html.match(/<p><strong>Worked example:<\/strong>[\s\S]*?<\/p>/)?.[0];
    assert.ok(worked, 'worked example remains one paragraph');
    assert.equal((worked.match(/class="inline-math"/g) || []).length, 3);
    assert.match(html, /，<\/span>标点与公式同行。/);
    assert.match(html, /class="display-math"/);
    assert.match(html, /class="katex-html" aria-hidden="true"/);
    assert.match(html, /class="katex-mathml"><math/);
    assert.match(html, /\.katex \.katex-mathml\{clip:/);
    assert.match(html, /\.inline-math \{ display: inline-block;/);
    assert.match(html, /data:font\/woff2;base64,/);
    assert.doesNotMatch(html, /url\(fonts\//);
    assert.doesNotMatch(html, /\*\*Example:/);
    assert.match(html, /class="hero-sub">One idea grounded in the source/);
    assert.match(html, /<body data-theme="forest">/);
    assert.match(html, /class="hero-map"[\s\S]*?A source fact/);
    assert.match(html, /class="pair-track"[\s\S]*?left:60%[\s\S]*?left:70%/);
    assert.match(html, /<span class="figure-kicker">本文整理的数据图<\/span>/);
    assert.match(html, /\+10\.0 个百分点/);
    assert.match(html, /-10\.0 个百分点/);
    assert.doesNotMatch(html, /class="pair-line"/);
    assert.match(html, /id="show-sources" type="checkbox"/);
    assert.doesNotMatch(html, /id="show-sources"[^>]*\bchecked\b/);
    assert.match(html, /#show-sources:not\(:checked\) ~ \* \.source-ref/);
    assert.match(html, /An observation can be read on its own\.<span class="source-ref">（PDF p\. 3, Fig\. 1）<\/span>/);
    assert.match(html, /Another observation stands alone <span class="source-ref">\(PDF p\. 5, Fig\. 2\)<\/span>\./);
    assert.match(html, /原论文 Fig\. 1<span class="source-ref">，PDF p\. 4<\/span>。图示说明留在本页。/);
  } finally {
    cleanTemp(dir);
  }
});


test('a figure caption with bold text closes before the next chapter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-figure-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7ZQAAAABJRU5ErkJggg==', 'base64'));
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    fs.writeFileSync(source, `<!-- paper-reading-lang: zh-CN -->
# Test Paper

## 01 / Figure

![Figure 13](pixel.png)

*原论文 Fig. 13，PDF p. 25。历史**上下文**决定接下来的一轮。*

## 02 / Next chapter

This chapter stays upright.
`);
    execFileSync(process.execPath, [renderer, source, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<figure class="paper-figure"><div class="figure-hint">↔ 横向滚动查看图内细节<\/div><div class="figure-viewport" tabindex="0" aria-label="↔ 横向滚动查看图内细节"><img src="data:image\/png;base64,[^"]+" alt="Figure 13"[^>]*><\/div><figcaption>原论文 Fig\. 13<span class="source-ref">，PDF p\. 25<\/span>。历史<strong>上下文<\/strong>决定接下来的一轮。<\/figcaption><\/figure>\s*<h2 id="section-2">02 \/ Next chapter<\/h2>/);
    assert.doesNotMatch(html, /<em>/);
    assert.match(html, /<p>This chapter stays upright\.<\/p>/);
  } finally {
    cleanTemp(dir);
  }
});


test('an English audit source produces an English reading page with a grounded map and chart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-en-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    fs.writeFileSync(source, `<!-- paper-reading-lang: en -->
<!-- paper-reading-theme: cobalt -->
# An Example Paper

\`\`\`paper-map
{"thesis":"An idea tested against a baseline.","items":[{"number":"01","label":"Idea","text":"The central mechanism.","source":"PDF p. 2"}]}
\`\`\`

## 01 / Main path

\`\`\`paper-path
{"title":"A two-stage method","stages":[{"title":"Prepare","role":"Input","action":"Collect evidence.","why":"The model needs examples.","output":"Examples for training.","source":"PDF p. 3"},{"title":"Test","role":"Output","action":"Compare outcomes.","why":"The claim needs a baseline.","output":"An observed result.","source":"PDF p. 4"}]}
\`\`\`

\`\`\`paper-chart
{"type":"paired","title":"Result","source":"PDF p. 5, Fig. 1","rows":[{"label":"Method","before":40,"after":60}]}
\`\`\`
`);
    execFileSync(process.execPath, [renderer, source, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<body data-theme="cobalt">/);
    assert.match(html, /Show source locations/);
    assert.match(html, /Whole-paper map/);
    assert.match(html, /Passed to the next stage/);
    assert.match(html, /What this stage leaves behind/);
    assert.match(html, /View chart data/);
    assert.match(html, /Start <strong>40%<\/strong>/);
    assert.match(html, /End <strong>60%<\/strong>/);
    assert.doesNotMatch(html, /paper-reading-lang: en|跳到正文|论文全局图|起点|交给下一阶段/);
  } finally {
    cleanTemp(dir);
  }
});


test('a visual fact without a source fails instead of publishing an untraceable diagram', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-source-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    fs.writeFileSync(source, '<!-- paper-reading-lang: en -->\n# Paper\n\n```paper-map\n{"items":[{"number":"01","label":"Claim","text":"An unverified claim."}]}\n```\n');
    assert.throws(() => execFileSync(process.execPath, [renderer, source, output], { stdio: 'pipe' }), /A visual fact is missing its source/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    cleanTemp(dir);
  }
});


test('an unknown visual theme fails before creating an output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reading-theme-test-'));
  try {
    const source = path.join(dir, 'paper.md');
    const output = path.join(dir, 'paper.html');
    fs.writeFileSync(source, '<!-- paper-reading-lang: en -->\n<!-- paper-reading-theme: neon -->\n# Paper\n');
    assert.throws(() => execFileSync(process.execPath, [renderer, source, output], { stdio: 'pipe' }), /Unknown paper-reading theme: neon/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    cleanTemp(dir);
  }
});

