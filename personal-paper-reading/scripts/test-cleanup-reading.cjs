const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {buildCleanupPlan,applyCleanup,main}=require('./cleanup-reading.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-cleanup-test-'));
 t.after(()=>{
  assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('paper-cleanup-test-'));
  fs.rmSync(root,{recursive:true,force:true});
 });
 const write=(rel,text='kept')=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p;};
 const skillDir=path.join(root,'personal-paper-reading');
 const extraction='work/图 提取';
 write(extraction+'/source.json',JSON.stringify({source_pdf:'source.pdf',page_count:2,rendered_pages:[1,2],crop_top_left_points:null}));
 write(extraction+'/paper-text.txt','=== PDF page 1 ===\nsource text');
 write(extraction+'/page-001.png','generated page 1');
 write(extraction+'/page-002.png','generated page 2');
 write('personal-paper-reading/scripts/__pycache__/extract-paper.cpython-312.pyc','bytecode');
 return {root,write,skillDir,extraction,options:{skillDir,extracted:[extraction]}};
}

test('preview changes nothing, while cleanup removes only selected generated files and tool caches',t=>{
 const {root,write,options,extraction}=fixture(t);
 const preserve=['notes/paper.md','notes/paper.html','notes/paper.assets/figure.png','notes/paper.md.notion-upload.json','personal-paper-reading/assets/notion.env','source.pdf','work/custom.tmp','test-report.json',extraction+'/source.json',extraction+'/draft.png'];
 preserve.forEach(f=>{if(!fs.existsSync(path.join(root,f)))write(f);});
 const plan=buildCleanupPlan(root,options);assert.equal(plan.candidates.length,4);
 assert.ok(plan.candidates.every(c=>fs.existsSync(c.path)));
 const result=applyCleanup(plan);assert.equal(result.removed.length,4);
 preserve.forEach(f=>assert.ok(fs.existsSync(path.join(root,f)),f));
 assert.equal(fs.existsSync(path.join(root,'personal-paper-reading/scripts/__pycache__')),false);
 assert.equal(buildCleanupPlan(root,options).candidates.length,0);
});

test('Markdown references protect extraction images including Unicode paths and filenames with spaces',t=>{
 const {root,write,options,extraction}=fixture(t);
 write('notes/paper.md',`# 保留\n\n![图](<../${extraction}/page-001.png>)\n\n[原文](../source.pdf)`);
 const plan=buildCleanupPlan(root,options);
 assert.ok(plan.skipped.some(c=>c.path.endsWith('page-001.png')));
 applyCleanup(plan);
 assert.ok(fs.existsSync(path.join(root,extraction,'page-001.png')));
 assert.equal(fs.existsSync(path.join(root,extraction,'page-002.png')),false);
});

test('images inside folded Markdown answers and HTML image references are preserved',t=>{
 const {root,write,options,extraction}=fixture(t);
 write('notes/paper.md',`<details>\n<summary>答案</summary>\n\n![答案图](<../${extraction}/page-001.png>)\n\n</details>`);
 write('notes/paper.html',`<img src="../${extraction}/page-002.png">`);
 const plan=buildCleanupPlan(root,options);applyCleanup(plan);
 assert.ok(fs.existsSync(path.join(root,extraction,'page-001.png')));
 assert.ok(fs.existsSync(path.join(root,extraction,'page-002.png')));
});

test('outside targets, final assets and malformed manifests are rejected before deletion',t=>{
 const {root,write,options,extraction}=fixture(t);
 for(const dir of ['..','notes/paper.assets','personal-paper-reading/assets']){
  if(dir!=='..')write(dir+'/source.json','{}');
  assert.throws(()=>buildCleanupPlan(root,{...options,extracted:[dir]}),/提取目录必须/);
 }
 write(extraction+'/source.json','{}');
 assert.throws(()=>buildCleanupPlan(root,options),/有效的 PDF 提取记录/);
 assert.ok(fs.existsSync(path.join(root,extraction,'page-001.png')));
 assert.throws(()=>buildCleanupPlan(path.parse(root).root),/专用工作区/);
 assert.throws(()=>buildCleanupPlan(os.homedir()),/专用工作区/);
});

test('directory junctions are never traversed and swapped ancestors cannot escape the boundary',t=>{
 const {root,write,options,extraction}=fixture(t);
 const target=path.join(root,'outside');write('outside/keep.pyc','keep');
 const link=path.join(root,'linked');fs.symlinkSync(target,link,'junction');
 assert.throws(()=>buildCleanupPlan(root,{...options,extracted:['linked']}),/提取目录必须/);
 const plan=buildCleanupPlan(root,options);
 const original=path.join(root,extraction);const moved=path.join(root,'saved-extraction');
 fs.renameSync(original,moved);fs.symlinkSync(moved,original,'junction');
 const result=applyCleanup(plan);
 assert.equal(result.removed.length,1); // only the unrelated Python cache is removed
 assert.ok(fs.existsSync(path.join(moved,'page-001.png')));
 assert.ok(fs.existsSync(path.join(target,'keep.pyc')));
});

test('receipt temporaries require a completed upload, dead process, no lock and at least 24 hours of age',t=>{
 const {root,write,skillDir}=fixture(t);
 let dead=2000000000;while(true){try{process.kill(dead,0);dead--;}catch(e){if(e.code==='ESRCH')break;dead--;}}
 const old=new Date(Date.now()-2*86400000);
 function receipt(name,status,{lock=false,recent=false,pid=dead}={}){
  const base='notes/'+name+'.md.notion-upload.json';write(base,JSON.stringify({status}));
  const tmp=write(base+'.'+pid+'.tmp','temporary receipt');if(!recent)fs.utimesSync(tmp,old,old);
  if(lock)write(base+'.lock','');return tmp;
 }
 const eligible=receipt('done','complete');
 const protectedFiles=[receipt('failed','writing_blocks'),receipt('locked','complete',{lock:true}),receipt('new','complete',{recent:true}),receipt('live','complete',{pid:process.pid})];
 const plan=buildCleanupPlan(root,{skillDir});
 assert.ok(plan.candidates.some(c=>c.path===eligible));
 applyCleanup(plan);assert.equal(fs.existsSync(eligible),false);
 protectedFiles.forEach(f=>assert.ok(fs.existsSync(f)));
 assert.ok(fs.existsSync(path.join(root,'notes/done.md.notion-upload.json')));
});

test('changed files and new note references after preview are preserved, and a forged out-of-root target aborts',t=>{
 const {root,write,options,extraction}=fixture(t);const plan=buildCleanupPlan(root,options);
 write(extraction+'/paper-text.txt','User edited text after preview');
 write('notes/new.md',`![new](<../${extraction}/page-002.png>)`);
 const result=applyCleanup(plan);
 assert.ok(result.skipped.some(c=>/发生变化/.test(c.reason)));
 assert.ok(result.skipped.some(c=>/新加入/.test(c.reason)));
 assert.ok(fs.existsSync(path.join(root,extraction,'page-002.png')));
 const next=buildCleanupPlan(root,options);
 next.candidates.push({path:path.join(root,'..','never-delete'),bytes:0});
 assert.throws(()=>applyCleanup(next),/工作区外路径/);
});

test('CLI defaults to preview, requires an explicit workspace and rejects conflicting modes',t=>{
 const {root}=fixture(t);const log=console.log;const output=[];console.log=s=>output.push(JSON.parse(s));t.after(()=>{console.log=log;});
 main(['--root',root]);assert.equal(output[0].mode,'dry-run');
 assert.throws(()=>main([]),/--root/);
 assert.throws(()=>main(['--root',root,'--apply','--dry-run']),/不能同时/);
});

test('stale manifests do not hide generated full pages or named batch crops',t=>{
 const {root,write,options,extraction}=fixture(t);
 write(extraction+'/source.json',JSON.stringify({source_pdf:'source.pdf',page_count:2,rendered_pages:[2],crop_top_left_points:[0,0,100,100]}));
 const generated=['page-001-clip.png','page-001-clip-fig1.png','page-002-clip-fig2.png'];
 const kept=['page-003.png','page-001-custom.png','draft.png','subdir/page-001.png'];
 generated.concat(kept).forEach(file=>write(extraction+'/'+file,'png'));
 const result=applyCleanup(buildCleanupPlan(root,options));
 assert.equal(result.removed.length,7);
 generated.concat(['page-001.png','page-002.png']).forEach(file=>assert.ok(!fs.existsSync(path.join(root,extraction,file))));
 kept.concat(['source.json']).forEach(file=>assert.ok(fs.existsSync(path.join(root,extraction,file))));
});

test('cleanup without npm dependencies preserves Markdown references and still removes unreferenced pages',t=>{
 const {root,write,extraction}=fixture(t);
 const standalone=write('standalone/cleanup-reading.cjs',fs.readFileSync(path.join(__dirname,'cleanup-reading.cjs'),'utf8'));
 write(extraction+'/page-002-clip-detail.png','detail');
 write(extraction+'/page-002-clip-unused.png','unused');
 write('notes/paper.md',`<details>\n![图][fig]\n\n[fig]: <../${extraction}/page-001.png>\n</details>\n\n![细节](<../${encodeURI(extraction)}/page-002-clip-detail.png>)`);
 // Force the optional parser to be unavailable, regardless of global installations.
 const loader="const M=require('node:module'),load=M._load;M._load=function(id,...rest){if(id==='marked'){const e=new Error('not installed');e.code='MODULE_NOT_FOUND';throw e;}return load.call(this,id,...rest)};require(process.argv[1]).main(process.argv.slice(2));";
 const result=spawnSync(process.execPath,['-e',loader,standalone,'--root',root,'--extracted',extraction,'--apply'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.ok(report.removed.some(c=>c.path.endsWith('page-002.png')));
 assert.ok(!fs.existsSync(path.join(root,extraction,'page-002-clip-unused.png')));
 for(const file of ['page-001.png','page-002-clip-detail.png']) assert.ok(fs.existsSync(path.join(root,extraction,file)));
 // A folder link protects all of its contents, including normalized .. segments.
 write('notes/folder.md',`[原始图](<../work/../${extraction}>)`);
 write(extraction+'/page-002.png','restored');
 const again=spawnSync(process.execPath,['-e',loader,standalone,'--root',root,'--extracted',extraction,'--apply'],{encoding:'utf8'});
 assert.equal(again.status,0,again.stderr);
 assert.ok(fs.existsSync(path.join(root,extraction,'page-002.png')));
});
