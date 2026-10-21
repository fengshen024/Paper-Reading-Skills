const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {buildPlan,normalizeId,NotionClient,publish,loadEnv,main} = require('./upload-to-notion.cjs');
const PARENT='12345678-1234-1234-1234-123456789abc';
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'notion-reading-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'note.md');
  fs.writeFileSync(path.join(dir,'图.png'),Buffer.from('89504e470d0a1a0a','hex'));
  fs.writeFileSync(source,'# 测试论文\n\n正文 **加粗** 与 $a_i$，代码 `$literal$`。\n\n$$\nx+y=z\n$$\n\n![原图](图.png)\n\n![再次引用](图.png)\n\n| 指标 | 数字 |\n|---|---|\n| MRR | 0.25 |\n\n<details>\n<summary>参考答案</summary>\n\n1. 看公式 $a_i$。\n2. 区分证据与推断。\n\n</details>\n');
  return {dir,source};
}
function allBlocks(items) {return items.flatMap(b=>[b,...allBlocks(b[b.type].children || [])]);}

test('real Markdown becomes typed equations, tables, toggles and deduplicated local images',t=>{
  const {source}=fixture(t);const plan=buildPlan(source,{parent:PARENT});
  assert.equal(plan.title,'测试论文');assert.equal(plan.assets.length,1);
  const blocks=allBlocks(plan.blocks);
  assert.equal(blocks.filter(b=>b.type === 'equation').length,1);
  assert.equal(blocks.find(b=>b.type === 'table').table.children.length,2);
  assert.equal(blocks.find(b=>b.type === 'toggle').toggle.children.length,2);
  const rich=blocks.flatMap(b=>b[b.type].rich_text || []);
  assert.ok(rich.some(x=>x.type === 'equation' && x.equation.expression === 'a_i'));
  assert.ok(rich.some(x=>x.type === 'text' && x.text.content === '$literal$' && x.annotations.code));
  assert.equal(blocks.filter(b=>b.type === 'image').length,2);
});

test('bad assets and unsupported HTML fail locally, and changed image bytes change the receipt key',t=>{
  const {source,dir}=fixture(t);const before=buildPlan(source);
  fs.appendFileSync(path.join(dir,'图.png'),'x');assert.notEqual(buildPlan(source).sha256,before.sha256);
  const outside=path.join(dir,'outside');const inside=path.join(dir,'inside');fs.mkdirSync(inside);fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside,'secret.png'),'content');
  fs.writeFileSync(path.join(inside,'other.md'),'![外部](../outside/secret.png)');
  assert.throws(()=>buildPlan(path.join(inside,'other.md')),/必须位于笔记目录/);
  fs.writeFileSync(source,'# Bad\n\n<div>unsupported</div>\n');assert.throws(()=>buildPlan(source),/不支持的 HTML/);
});

test('page URL parsing ignores the database view query, and env files never override shell values',t=>{
  const {dir}=fixture(t);const envFile=path.join(dir,'config.env');
  fs.writeFileSync(envFile,'# local only\nNOTION_TOKEN="file-token"\nNOTION_PARENT_PAGE_ID='+PARENT+'\n');
  const env={NOTION_TOKEN:'shell-token'};loadEnv(envFile,env);
  assert.equal(env.NOTION_TOKEN,'shell-token');assert.equal(env.NOTION_PARENT_PAGE_ID,PARENT);
  assert.equal(normalizeId('https://www.notion.so/My-page-'+PARENT.replaceAll('-','')+'?v=abcdef'),PARENT);
  assert.throws(()=>normalizeId('not-an-id'),/ID 无效/);
});

test('upload order, file multipart request, schema title discovery and repeat guard work end to end',async t=>{
  const {source}=fixture(t);const requests=[];let blockId=0;
  const client=new NotionClient('fake-test-token',{fetchImpl:async (url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer fake-test-token');
    assert.equal(options.headers['Notion-Version'],'2026-03-11');
    assert.equal(options.redirect,'error');
    const endpoint=url.replace('https://api.notion.com/v1','');
    requests.push({endpoint,options});let data;
    if(endpoint === '/users/me') data={id:'bot',bot:{workspace_limits:{max_file_upload_size_in_bytes:20000000}}};
    else if(endpoint.startsWith('/data_sources/')) data={properties:{论文名称:{type:'title'}}};
    else if(endpoint === '/file_uploads') data={id:'uploaded-file-id'};
    else if(endpoint.endsWith('/send')) {
      assert.ok(options.body instanceof FormData);assert.ok(options.body.get('file') instanceof Blob);
      assert.equal(options.headers['Content-Type'],undefined);data={status:'uploaded'};
    } else if(endpoint === '/pages') {
      const body=JSON.parse(options.body);assert.ok(body.properties.论文名称);assert.equal(body.parent.type,'data_source_id');
      data={id:'new-page',url:'https://www.notion.so/new-page'};
    } else if(endpoint.endsWith('/children')) {
      const children=JSON.parse(options.body).children;assert.ok(children.length <= 50);
      assert.ok(Buffer.byteLength(options.body) < 500000);
      for(const b of children) {
        if(b.type === 'image') assert.equal(b.image.file_upload.id,'uploaded-file-id');
        if(b.type === 'table') assert.equal(b.table.children.length,1);
        else assert.equal(b[b.type].children,undefined);
      }
      data={results:children.map(()=>({id:'block-'+ ++blockId}))};
    } else throw new Error('Unexpected URL '+url);
    return new Response(JSON.stringify(data),{status:200});
  }});
  const plan=buildPlan(source,{dataSource:PARENT});const receipt=await publish(plan,{client});
  assert.equal(receipt.status,'complete');assert.equal(receipt.uploads.length,1);
  const sends=requests.filter(r=>r.endpoint.endsWith('/send'));assert.equal(sends.length,1);
  assert.ok(requests.findIndex(r=>r.endpoint.endsWith('/send')) < requests.findIndex(r=>r.endpoint === '/pages'));
  const count=requests.length;assert.equal((await publish(plan,{client})).skipped,true);assert.equal(requests.length,count);
  fs.appendFileSync(source,'\nNew paragraph.');await assert.rejects(publish(buildPlan(source,{dataSource:PARENT}),{client}),/已有上传回执/);
  assert.equal(fs.existsSync(source+'.notion-upload.json.lock'),false);
});

test('ambiguous write failure leaves a page receipt and blocks automatic duplication',async t=>{
  const {source}=fixture(t);const plan=buildPlan(source,{parent:PARENT});plan.assets=[];plan.blocks=[{object:'block',type:'paragraph',paragraph:{rich_text:[]}}];
  let writes=0;
  const client={check:async()=>({title_property:'title'}),request:async (method,endpoint)=>{
    writes++;if(endpoint === '/pages') return {id:'partial',url:'https://www.notion.so/partial'};
    throw new Error('simulated network timeout');
  }};
  await assert.rejects(publish(plan,{client}),/部分页面/);
  const receipt=JSON.parse(fs.readFileSync(source+'.notion-upload.json','utf8'));
  assert.equal(receipt.status,'writing_blocks');assert.equal(receipt.page_id,'partial');assert.equal(writes,2);
  await assert.rejects(publish(plan,{client}),/已有上传回执/);assert.equal(writes,2);
});

test('only explicit rate limits are retried; auth and ambiguous server failures are not',async()=>{
  let calls=0;const pauses=[];
  const client=new NotionClient('fake-token',{pause:async ms=>pauses.push(ms),fetchImpl:async()=>{
    calls++;return calls < 3 ? new Response('{}',{status:429,headers:{'retry-after':'1'}}) : new Response('{"id":"ok"}');
  }});
  assert.equal((await client.request('GET','/users/me')).id,'ok');assert.deepEqual(pauses,[1000,1000]);
  for(const status of [401,403,404,500]) {
    let tries=0;const bad=new NotionClient('fake-token',{fetchImpl:async()=>{tries++;return new Response('{"code":"error"}',{status});}});
    await assert.rejects(bad.request('POST','/pages',{}),new RegExp('HTTP '+status));assert.equal(tries,1);
  }
});

test('dry-run needs no token and makes no remote request or upload receipt',async t=>{
  const {source}=fixture(t);const original=global.fetch;
  global.fetch=async()=>{throw new Error('network must not be called');};t.after(()=>{global.fetch=original;});
  await main([source,'--dry-run'],{});
  assert.equal(fs.existsSync(source+'.notion-upload.json'),false);
});

test('workspace PAT creates a separate top-level page per note and supports explicit new versions',async t=>{
  const {source,dir}=fixture(t);
  fs.writeFileSync(source,'# 论文 A\n\nA 的笔记。');
  const second=path.join(dir,'second.md');fs.writeFileSync(second,'# 论文 B\n\nB 的笔记。');
  const pages=[];const targets=[];
  const client=new NotionClient('fake-pat',{fetchImpl:async(url,options)=>{
    const endpoint=url.replace('https://api.notion.com/v1','');let data;
    if(endpoint === '/users/me') data={id:'bot',bot:{owner:{type:'user',user:{id:'owner'}},workspace_name:'研究工作区'}};
    else if(endpoint === '/pages') {
      const body=JSON.parse(options.body);assert.deepEqual(body.parent,{type:'workspace',workspace:true});
      const id='page-'+(pages.length+1);pages.push({id,title:body.properties.title.title[0].text.content});
      data={id,url:'https://www.notion.so/'+id};
    } else if(endpoint.endsWith('/children')) {
      targets.push(endpoint);data={results:JSON.parse(options.body).children.map((_,i)=>({id:'block-'+i}))};
    } else throw new Error('Unexpected endpoint: '+endpoint);
    return new Response(JSON.stringify(data));
  }});
  const a=buildPlan(source,{workspace:true});const b=buildPlan(second,{workspace:true});
  assert.equal((await publish(a,{client})).status,'complete');
  assert.equal((await publish(b,{client})).status,'complete');
  assert.equal((await publish(a,{client})).skipped,true);
  assert.equal(pages.length,2);assert.deepEqual(pages.map(p=>p.title),['论文 A','论文 B']);
  assert.deepEqual(targets,['/blocks/page-1/children','/blocks/page-2/children']);
  const next=await publish(a,{client,newPage:true});assert.equal(next.page_id,'page-3');
  assert.equal(next.previous_page,'https://www.notion.so/page-1');
});

test('workspace internal connection is rejected before images or pages are written',async t=>{
  const {source}=fixture(t);const methods=[];
  const client=new NotionClient('fake-internal',{fetchImpl:async(url,options)=>{
    methods.push(options.method);assert.ok(url.endsWith('/users/me'));
    return new Response(JSON.stringify({id:'bot',bot:{owner:{type:'workspace'}}}));
  }});
  await assert.rejects(publish(buildPlan(source,{workspace:true}),{client}),/需要 PAT/);
  assert.deepEqual(methods,['GET']);assert.equal(fs.existsSync(source+'.notion-upload.json'),false);
});

test('workspace destination can be selected locally without network and conflicts fail early',async t=>{
  const {source}=fixture(t);const original=global.fetch;const log=console.log;const output=[];
  global.fetch=async()=>{throw new Error('No network expected');};console.log=s=>output.push(JSON.parse(s));
  t.after(()=>{global.fetch=original;console.log=log;});
  await main([source,'--dry-run'],{NOTION_WORKSPACE_ROOT:'true'});
  await main([source,'--dry-run','--workspace'],{NOTION_PARENT_PAGE_ID:PARENT});
  assert.ok(output.every(x=>x.parent.type === 'workspace'));
  await main([source,'--dry-run','--parent',PARENT],{NOTION_WORKSPACE_ROOT:'true'});
  assert.equal(output.at(-1).parent.page_id,PARENT);
  await assert.rejects(main([source,'--dry-run','--workspace','--parent',PARENT],{}),/只能选择一个/);
  await assert.rejects(main([source,'--dry-run'],{NOTION_WORKSPACE_ROOT:'true',NOTION_PARENT_PAGE_ID:PARENT}),/只能选择一个/);
  await assert.rejects(main([source,'--dry-run'],{NOTION_WORKSPACE_ROOT:'yes'}),/只能是 true 或 false/);
  assert.throws(()=>buildPlan(source,{parent:PARENT,workspace:true}),/只能选择一个/);
});

// Fictional IDs: never use a real workspace/database identifier in public fixtures.
const DATABASE_LINK='https://app.notion.com/p/aaaaaaaabbbb4ccc8dddeeeeeeeeeeee?v=11111111222243338444555555555555';
const DATABASE_ID='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('database link resolves the sole data source and creates separate record pages with native bodies',async t=>{
  const {source,dir}=fixture(t);fs.writeFileSync(source,'# 论文甲\n\n甲的正文。');
  const second=path.join(dir,'second.md');fs.writeFileSync(second,'# 论文乙\n\n乙的正文。');
  const requests=[];const created=[];const bodies=[];
  const client=new NotionClient('fake-token',{fetchImpl:async(url,options)=>{
    const endpoint=url.replace('https://api.notion.com/v1','');requests.push(endpoint);let data;
    if(endpoint === '/users/me') data={id:'bot',bot:{owner:{type:'workspace'}}};
    else if(endpoint === '/databases/'+DATABASE_ID) data={data_sources:[{id:PARENT,name:'论文阅读'}]};
    else if(endpoint === '/data_sources/'+PARENT) data={properties:{论文标题:{type:'title'},年份:{type:'number'}}};
    else if(endpoint === '/pages') {
      const body=JSON.parse(options.body);assert.deepEqual(body.parent,{type:'data_source_id',data_source_id:PARENT});
      assert.deepEqual(Object.keys(body.properties),['论文标题']);created.push(body.properties.论文标题.title[0].text.content);
      data={id:'paper-'+created.length,url:'https://www.notion.so/paper-'+created.length};
    } else if(endpoint.endsWith('/children')) {
      const children=JSON.parse(options.body).children;bodies.push({endpoint,text:children[0].paragraph.rich_text[0].text.content});
      data={results:children.map((_,i)=>({id:'block-'+i}))};
    } else throw new Error('Unexpected endpoint: '+endpoint);
    return new Response(JSON.stringify(data));
  }});
  const plan=buildPlan(source,{database:DATABASE_LINK});assert.equal(plan.parent.database_id,DATABASE_ID);
  const first=await publish(plan,{client});assert.equal(first.status,'complete');
  assert.equal(first.parent.database_id,DATABASE_ID);assert.equal(first.resolved_parent.data_source_id,PARENT);
  assert.equal(requests[0],'/users/me');assert.equal(requests[1],'/databases/'+DATABASE_ID);assert.equal(requests[2],'/data_sources/'+PARENT);
  await publish(buildPlan(second,{database:DATABASE_LINK}),{client});
  assert.deepEqual(created,['论文甲','论文乙']);
  assert.deepEqual(bodies,[{endpoint:'/blocks/paper-1/children',text:'甲的正文。'},{endpoint:'/blocks/paper-2/children',text:'乙的正文。'}]);
  const count=requests.length;assert.equal((await publish(plan,{client})).skipped,true);assert.equal(requests.length,count);
});

test('empty, ambiguous or inaccessible databases fail before any remote write',async t=>{
  const {source}=fixture(t);
  for(const kind of ['empty','multiple','forbidden']) {
    const methods=[];
    const client=new NotionClient('fake-token',{fetchImpl:async(url,options)=>{
      methods.push(options.method);
      if(url.endsWith('/users/me')) return new Response('{"id":"bot"}');
      assert.ok(url.endsWith('/databases/'+DATABASE_ID));
      if(kind === 'forbidden') return new Response('{"code":"object_not_found"}',{status:404});
      return new Response(JSON.stringify({data_sources:kind === 'empty' ? [] : [{id:PARENT,name:'A'},{id:DATABASE_ID,name:'B'}]}));
    }});
    await assert.rejects(publish(buildPlan(source,{database:DATABASE_LINK}),{client}),kind === 'empty' ? /没有可用 data source/ : kind === 'multiple' ? /多个 data source/ : /HTTP 404/);
    assert.deepEqual(methods,['GET','GET']);assert.equal(fs.existsSync(source+'.notion-upload.json'),false);
  }
});

test('database CLI and env accept the copied URL locally, with explicit destination override and conflict checks',async t=>{
  const {source}=fixture(t);const original=global.fetch;const log=console.log;const output=[];
  global.fetch=async()=>{throw new Error('No network expected');};console.log=s=>output.push(JSON.parse(s));
  t.after(()=>{global.fetch=original;console.log=log;});
  await main([source,'--dry-run'],{NOTION_DATABASE_ID:DATABASE_LINK});
  await main([source,'--dry-run','--database',DATABASE_LINK],{NOTION_PARENT_PAGE_ID:PARENT,NOTION_WORKSPACE_ROOT:'true'});
  assert.ok(output.every(x=>x.parent.database_id === DATABASE_ID));
  await main([source,'--dry-run','--data-source',PARENT],{NOTION_DATABASE_ID:DATABASE_LINK});
  assert.equal(output.at(-1).parent.data_source_id,PARENT);
  await assert.rejects(main([source,'--dry-run'],{NOTION_DATABASE_ID:DATABASE_LINK,NOTION_PARENT_PAGE_ID:PARENT}),/只能选择一个/);
  await assert.rejects(main([source,'--dry-run','--database',DATABASE_LINK,'--data-source',PARENT],{}),/只能选择一个/);
  assert.throws(()=>buildPlan(source,{database:DATABASE_LINK,workspace:true}),/只能选择一个/);
});
