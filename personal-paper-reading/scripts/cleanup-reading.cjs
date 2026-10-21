#!/usr/bin/env node
// Conservative cleanup of this skill's generated intermediates. No remote calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {marked} = require('marked');

const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
const same = (a,b) => path.relative(a,b) === '';
const excluded = new Set(['node_modules','.git','.hg','.svn']);
const finalDirectory = p => p.split(path.sep).some(s => /^(?:notes|assets|examples|references)$/i.test(s) || /\.assets$/i.test(s));
function checkedRoot(input) {
  if (!input) throw new Error('必须用 --root 明确指定本次阅读工作区。');
  const root = fs.realpathSync(input);
  if (!fs.statSync(root).isDirectory() || same(root,path.parse(root).root) || same(root,os.homedir())) throw new Error('清理范围必须是专用工作区，不能是磁盘根目录或用户主目录。');
  return root;
}
function safePath(root, target) {
  if (!inside(root,target)) return false;
  let current = root;
  for (const part of path.relative(root,target).split(path.sep)) {
    current = path.join(current,part);
    try { if (fs.lstatSync(current).isSymbolicLink()) return false; }
    catch (e) { if(e.code === 'ENOENT') return false; throw e; }
  }
  return inside(root,fs.realpathSync(target));
}
function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
    const file = path.join(dir,entry.name);
    if(entry.isDirectory()) walk(file,visit);
    else if(entry.isFile()) visit(file);
  }
}
function references(root) {
  const refs = new Set();
  function add(from, value) {
    if (!value || /^(?:https?:|mailto:|data:|#)/i.test(value)) return;
    try {
      const local = decodeURIComponent(value.split('#')[0].split('?')[0]);
      const target = path.resolve(path.dirname(from),local);
      refs.add(fs.existsSync(target) ? fs.realpathSync(target) : target);
    } catch { /* Invalid links do not authorize deletion. */ }
  }
  walk(root,file => {
    if (!/\.(?:md|html|css)$/i.test(file)) return;
    const text = fs.readFileSync(file,'utf8');
    if (/\.md$/i.test(file)) {
      // Marked treats details bodies as HTML; parse again without the folding wrappers.
      const unfolded=text.replace(/<\/?(?:details|summary)\b[^>]*>/gi,'');
      for (const version of new Set([text,unfolded])) marked.walkTokens(marked.lexer(version),token => {
        if (token.type === 'image' || token.type === 'link') add(file,token.href);
      });
    }
    for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) add(file,m[1]);
    for (const m of text.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/gi)) add(file,m[1]);
  });
  return refs;
}
function processAlive(pid) {
  try { process.kill(pid,0); return true; }
  catch (e) { return e.code !== 'ESRCH'; }
}
function receiptTempSafe(file, now) {
  const m = /^(.*\.notion-upload\.json)\.(\d+)\.tmp$/.exec(file);
  if (!m || fs.existsSync(m[1]+'.lock') || processAlive(Number(m[2]))) return false;
  try {
    return JSON.parse(fs.readFileSync(m[1],'utf8')).status === 'complete' && now-fs.statSync(file).mtimeMs >= 86400000;
  } catch { return false; }
}

function buildCleanupPlan(rootInput,{extracted=[],skillDir=path.resolve(__dirname,'..'),now=Date.now()}={}) {
  const root = checkedRoot(rootInput), refs = references(root);
  const candidates = [], skipped = [], seen = new Set(), cacheDirs = new Set();
  function add(file,reason) {
    if (seen.has(file)) return;
    seen.add(file);
    if (!safePath(root,file)) {skipped.push({path:file,reason:'链接或越界路径'});return;}
    if ([...refs].some(ref => same(ref,file) || inside(ref,file))) {skipped.push({path:file,reason:'被 Markdown/HTML/CSS 引用'});return;}
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink > 1) {skipped.push({path:file,reason:'非普通文件或硬链接'});return;}
    candidates.push({path:file,reason,bytes:stat.size,mtimeMs:stat.mtimeMs,ino:stat.ino,dev:stat.dev});
  }
  for (const input of extracted) {
    const dir = path.resolve(root,input);
    if (!safePath(root,dir) || !fs.statSync(dir).isDirectory() || finalDirectory(path.relative(root,dir))) throw new Error('提取目录必须位于工作区内，不能使用笔记、assets 或链接目录。');
    const manifest = path.join(dir,'source.json');
    if (!safePath(root,manifest)) throw new Error('提取目录缺少普通 source.json 来源文件。');
    const meta = JSON.parse(fs.readFileSync(manifest,'utf8'));
    if (typeof meta.source_pdf !== 'string' || !/\.pdf$/i.test(meta.source_pdf) || !Number.isInteger(meta.page_count) || meta.page_count < 1 || !Array.isArray(meta.rendered_pages) || !meta.rendered_pages.every(n=>Number.isInteger(n)&&n>=1&&n<=meta.page_count)) throw new Error('source.json 不是有效的 PDF 提取记录。');
    const text = path.join(dir,'paper-text.txt');
    if (safePath(root,text) && fs.readFileSync(text,'utf8').startsWith('=== PDF page 1 ===')) add(text,'可重新提取的 PDF 文本');
    for (const n of meta.rendered_pages) {
      const image = path.join(dir,`page-${String(n).padStart(3,'0')}${meta.crop_top_left_points ? '-clip' : ''}.png`);
      if (fs.existsSync(image)) add(image,'已指定提取目录中的页图/裁剪中间件');
    }
  }
  const scripts = path.join(path.resolve(skillDir),'scripts');
  if (safePath(root,scripts)) walk(scripts,file => {
    if (path.basename(path.dirname(file)) === '__pycache__' && /\.pyc$/i.test(file)) {add(file,'本 skill 的 Python 字节码缓存');cacheDirs.add(path.dirname(file));}
  });
  walk(root,file => {if (/\.notion-upload\.json\.\d+\.tmp$/.test(file) && receiptTempSafe(file,now)) add(file,'成功上传遗留且超过 24 小时的回执临时文件');});
  return {root,candidates,skipped,cache_dirs:[...cacheDirs],bytes:candidates.reduce((n,c)=>n+c.bytes,0)};
}

function applyCleanup(plan) {
  const root = checkedRoot(plan.root), removed = [], skipped = [...plan.skipped];
  // Validate the absolute boundary for every target before the first deletion.
  if (plan.candidates.some(c=>!inside(root,c.path)) || plan.cache_dirs.some(d=>!inside(root,d))) throw new Error('清理计划含工作区外路径，已停止。');
  const refs=references(root);
  for (const entry of plan.candidates) {
    const file = entry.path;
    if (!safePath(root,file)) {skipped.push({path:file,reason:'路径已消失或变为链接'});continue;}
    if ([...refs].some(ref => same(ref,file) || inside(ref,file))) {skipped.push({path:file,reason:'文件被新加入的正文引用'});continue;}
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink > 1 || stat.size !== entry.bytes || stat.mtimeMs !== entry.mtimeMs || stat.ino !== entry.ino || stat.dev !== entry.dev) {skipped.push({path:file,reason:'预览后文件发生变化'});continue;}
    if (/\.notion-upload\.json\.\d+\.tmp$/.test(file) && !receiptTempSafe(file,Date.now())) {skipped.push({path:file,reason:'上传状态已变化'});continue;}
    // Never recursively remove a directory or follow a link.
    fs.unlinkSync(file); removed.push(entry);
  }
  for (const dir of plan.cache_dirs) if (safePath(root,dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  return {root,removed,skipped,bytes:removed.reduce((n,c)=>n+c.bytes,0)};
}

function main(args=process.argv.slice(2)) {
  let root, apply=false;const extracted=[];
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if (arg==='--root' || arg==='--extracted') {
      if(!args[i+1] || args[i+1].startsWith('--')) throw new Error(arg+' 需要路径。');
      const value=args[++i];if(arg==='--root') root=value;else extracted.push(value);
    } else if(arg==='--apply') apply=true;
    else if(arg==='--dry-run') continue;
    else if(arg==='--help') {console.log('node scripts/cleanup-reading.cjs --root WORKSPACE [--extracted RELATIVE_OR_ABSOLUTE_DIR ...] [--dry-run | --apply]\nDefault: preview only. Repeat --extracted for each finished PDF extraction folder. Notes, assets, source.json, env, reports and upload receipts are retained.');return;}
    else throw new Error('未知参数：'+arg);
  }
  if(apply && args.includes('--dry-run')) throw new Error('--apply 与 --dry-run 不能同时使用。');
  const plan=buildCleanupPlan(root,{extracted});
  const result=apply ? applyCleanup(plan) : plan;
  console.log(JSON.stringify({mode:apply?'applied':'dry-run',...result},null,2));
}
module.exports={buildCleanupPlan,applyCleanup,main};
if(require.main===module) try{main();}catch(e){console.error(e.message);process.exitCode=1;}
