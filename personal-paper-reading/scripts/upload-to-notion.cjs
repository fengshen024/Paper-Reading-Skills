#!/usr/bin/env node
// Native Notion REST API publisher. Requires Node >=22.12 and the skill's marked dependency.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Marked, Lexer } = require('marked');
const API = 'https://api.notion.com/v1';
const VERSION = '2026-03-11';
const LIMIT = 20 * 1024 * 1024;
const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml'};
const languages = new Set(['plain text','python','javascript','typescript','json','bash','shell','powershell','sql','html','css','xml','yaml','markdown','latex','mermaid','c','c++','java','rust','go','r']);
const unescape = s => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, x) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'"}[x]));
const parser = new Marked({gfm:true, extensions:[
  {name:'readingDetails',level:'block',start:s=>s.indexOf('<details'),tokenizer(s){const m=/^<details(?:\s[^>]*)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>[^\S\n]*(?:\n|$)/i.exec(s);if(m){if(/<details\b/i.test(m[2])) throw new Error('暂不支持嵌套 details，请拆成并列折叠块。');return {type:'readingDetails',raw:m[0],summary:m[1].trim(),text:m[2].trim()};}}},
  {name:'readingEquation',level:'block',start:s=>s.indexOf('$$'),tokenizer(s){const m=/^\$\$\s*\n([\s\S]*?)\n\s*\$\$(?:\n|$)/.exec(s);if(m)return {type:'readingEquation',raw:m[0],text:m[1].trim()};}},
  {name:'readingInlineMath',level:'inline',start:s=>s.indexOf('$'),tokenizer(s){const m=/^\$(?!\$)((?:\\.|[^$\n])+?)\$(?!\$)/.exec(s);if(m)return {type:'readingInlineMath',raw:m[0],text:m[1]};}},
]});

function splitText(text, annotations = {}, link) {
  const result = [];
  // Work on code points to avoid splitting a surrogate pair at the API's text limit.
  let part = '';
  for (const ch of text) {
    if (part.length + ch.length > 2000) { result.push(part); part = ''; }
    part += ch;
  }
  if (part) result.push(part);
  return result.map(content => ({type:'text',text:{content,...(link ? {link:{url:link}} : {})},annotations}));
}

function normalizeId(input) {
  let value = input;
  if (/^https?:\/\//i.test(value)) value = new URL(value).pathname.split('/').filter(Boolean).at(-1) || '';
  const match = value.match(/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}|[a-f\d]{32})$/i);
  if (!match) throw new Error('Notion ID 无效：请使用页面链接或 32 位/UUID 格式的 ID。');
  const hex = match[1].replaceAll('-','');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function buildPlan(source, {title, parent, database, dataSource, workspace = false} = {}) {
  if ([!!parent,!!database,!!dataSource,!!workspace].filter(Boolean).length > 1) throw new Error('父页面、数据库、data source、工作区顶层只能选择一个。');
  source = fs.realpathSync(source);
  const root = fs.realpathSync(path.dirname(source));
  const original = fs.readFileSync(source,'utf8').replace(/^\uFEFF/,'');
  const warnings = new Set();
  const assets = [];
  const plain = tokens => (tokens || []).map(t => t.tokens ? plain(t.tokens) : (t.text || '')).join('');
  function rich(tokens, annotations = {}) {
    return (tokens || []).flatMap(t => {
      if (t.type === 'readingInlineMath') {
        if (t.text.length > 2000) throw new Error('行内公式超过 Notion 的 2000 字符限制。');
        return [{type:'equation',equation:{expression:t.text},annotations}];
      }
      const formats = {strong:'bold',em:'italic',del:'strikethrough'};
      if (formats[t.type]) return rich(t.tokens,{...annotations,[formats[t.type]]:true});
      if (t.type === 'codespan') return splitText(t.text,{...annotations,code:true});
      if (t.type === 'link' || t.type === 'autolink') {
        if (/^(https?:|mailto:)/i.test(t.href)) return rich(t.tokens || [{type:'text',text:t.text}],annotations).map(x => x.type === 'text' ? {...x,text:{...x.text,link:{url:t.href}}} : x);
        warnings.add('本地文件/锚点链接按可读文字保留；本次只上传正文中的图片，不上传链接指向的 PDF。');
        return splitText(`${plain(t.tokens) || t.text}（本地链接：${t.href}）`,annotations);
      }
      if (t.type === 'image') throw new Error('嵌在强调/链接中的图片暂不支持；请将图片单独放一行。');
      if (t.type === 'br') return splitText('\n',annotations);
      if (t.type === 'html') {
        if (/^<br\s*\/?>$/i.test(t.text)) return splitText('\n',annotations);
        if (/^<!--[\s\S]*-->$/.test(t.text)) return [];
        throw new Error(`不支持的行内 HTML：${t.text.slice(0,70)}`);
      }
      return t.tokens ? rich(t.tokens,annotations) : splitText(unescape(t.text || ''),annotations);
    });
  }
  const block = (type, data) => ({object:'block',type,[type]:data});
  function image(t) {
    if (/^https:\/\//i.test(t.href)) return block('image',{type:'external',external:{url:t.href},caption:splitText(t.text || '')});
    if (/^[a-z][a-z\d+.-]*:/i.test(t.href)) throw new Error(`图片必须为 HTTPS 或笔记目录内的本地文件：${t.href}`);
    const file = fs.realpathSync(path.resolve(root,decodeURIComponent(t.href)));
    const relative = path.relative(root,file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('本地图片必须位于笔记目录或其子目录内。');
    const type = mime[path.extname(file).toLowerCase()];
    if (!type) throw new Error(`暂不支持的图片格式：${file}`);
    const size = fs.statSync(file).size;
    if (!size || size > LIMIT) throw new Error(`图片为空或超过 20 MiB：${file}`);
    let index = assets.findIndex(x => x.path === file);
    if (index < 0) { index = assets.length;assets.push({path:file,size,content_type:type,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}); }
    // Placeholder is resolved only after a successful file upload.
    return block('image',{type:'file_upload',file_upload:{id:`LOCAL_IMAGE_${index}`},caption:splitText(t.text || '')});
  }
  function flow(tokens) {
    const out = [];let run = [];
    const flush = () => {if(run.length){out.push(block('paragraph',{rich_text:rich(run)}));run=[];}};
    for(const t of tokens || []) {if(t.type === 'image'){flush();out.push(image(t));}else run.push(t);}
    flush();return out;
  }
  function convert(tokens) {
    return tokens.flatMap(t => {
      switch(t.type) {
        case 'space': case 'def': return [];
        case 'heading': return [block(`heading_${Math.min(3,t.depth)}`,{rich_text:rich(t.tokens)})];
        case 'paragraph': case 'text': return flow(t.tokens || Lexer.lexInline(t.text,parser.defaults));
        case 'readingDetails': return [block('toggle',{rich_text:rich(Lexer.lexInline(t.summary,parser.defaults)),children:convert(parser.lexer(t.text))})];
        case 'readingEquation':
          if(t.text.length > 2000) throw new Error('独立公式超过 Notion 的 2000 字符限制。');
          return [block('equation',{expression:t.text})];
        case 'hr': return [block('divider',{})];
        case 'blockquote': return [block('quote',{rich_text:[],children:convert(t.tokens)})];
        case 'list': return t.items.map(item => {
          const children = convert(item.tokens);
          const first = children[0]?.type === 'paragraph' ? children.shift().paragraph.rich_text : [];
          const type = item.task ? 'to_do' : (t.ordered ? 'numbered_list_item' : 'bulleted_list_item');
          return block(type,{rich_text:first,...(item.task ? {checked:item.checked} : {}),...(children.length ? {children} : {})});
        });
        case 'table': return [block('table',{
          table_width:t.header.length,has_column_header:true,has_row_header:false,
          children:[t.header,...t.rows].map(row => block('table_row',{cells:row.map(cell => rich(cell.tokens))})),
        })];
        case 'code': {
          let language = ({text:'plain text',js:'javascript',ts:'typescript',py:'python',sh:'shell',ps1:'powershell'})[t.lang] || t.lang || 'plain text';
          if(!languages.has(language)){warnings.add(`代码语言 ${language} 按 plain text 保留。`);language='plain text';}
          return [block('code',{rich_text:splitText(t.text),language})];
        }
        case 'html': {
          if(/^\s*<!--[\s\S]*-->\s*$/.test(t.text)) return [];
          const details = /^\s*<details(?:\s[^>]*)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*$/i.exec(t.text);
          if(details) return [block('toggle',{rich_text:rich(Lexer.lexInline(details[1].trim(),parser.defaults)),children:convert(parser.lexer(details[2].trim()))})];
          throw new Error(`不支持的 HTML 块；上传前请改为 Markdown：${t.text.slice(0,80)}`);
        }
        default: throw new Error(`暂不支持的 Markdown 元素：${t.type}`);
      }
    });
  }
  const tokens = parser.lexer(original);
  const firstHeading = tokens.find(t=>t.type === 'heading' && t.depth === 1);
  title ||= firstHeading ? plain(firstHeading.tokens) : path.basename(source,path.extname(source));
  if(!title.trim() || title.length > 2000) throw new Error('页面标题不能为空，且不得超过 2000 字符。');
  if(firstHeading) tokens.splice(tokens.indexOf(firstHeading),1);
  const blocks = convert(tokens);
  let blockCount = 0;
  function validate(items) {
    for(const b of items) {
      blockCount++; const content = b[b.type];
      for(const field of ['rich_text','caption']) if(content[field]?.length > 100) throw new Error('文本块超过 100 个 rich_text 片段，请拆成多个段落/代码块。');
      for(const cell of content.cells || []) if(cell.length > 100) throw new Error('表格单元格过长，请拆分。');
      validate(content.children || []);
    }
  }
  validate(blocks);
  return {source,title,parent:parent ? {type:'page_id',page_id:normalizeId(parent)} : database ? {type:'database_id',database_id:normalizeId(database)} : dataSource ? {type:'data_source_id',data_source_id:normalizeId(dataSource)} : workspace ? {type:'workspace',workspace:true} : null,
    sha256:createHash('sha256').update(original).update(JSON.stringify(assets.map(x=>x.sha256))).digest('hex'),
    assets,blocks,block_count:blockCount,warnings:[...warnings]};
}

class NotionClient {
  constructor(token,{fetchImpl = fetch, pause = ms => new Promise(resolve=>setTimeout(resolve,ms))} = {}) {this.token=token;this.fetch=fetchImpl;this.pause=pause;}
  async request(method, endpoint, body) {
    for(let attempt=0;;attempt++) {
      let response;
      try {
        response=await this.fetch(API+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${this.token}`,'Notion-Version':VERSION,...(body instanceof FormData ? {} : {'Content-Type':'application/json'})},...(body === undefined ? {} : {body:body instanceof FormData ? body : JSON.stringify(body)})});
      } catch {throw new Error(`Notion ${method} ${endpoint} 网络错误/超时。写入结果可能未知；未自动重试，请先检查目标页面和回执。`);}
      if(response.status === 429 && attempt < 3) {
        const delay = Math.ceil(Number(response.headers.get('retry-after') || 1)*1000);
        if(!Number.isFinite(delay) || delay < 0 || delay > 30000) throw new Error('Notion 限流等待时间过长；已停止，请稍后检查并重试。');
        await response.arrayBuffer();await this.pause(delay);continue;
      }
      const text=await response.text();let data;
      try {data=JSON.parse(text);}catch {throw new Error(`Notion 返回非 JSON 响应（HTTP ${response.status}）；未自动重试。`);}
      if(!response.ok) {
        const hint=({401:'token 无效或已过期。',403:'检查连接的读取/插入内容权限。',404:'检查 ID，并将目标页面/数据库共享给连接。'})[response.status] || '已停止，未自动重试该写入。';
        throw new Error(`Notion HTTP ${response.status} (${data.code || 'error'})：${hint}`);
      }
      return data;
    }
  }
  async check(parent) {
    const user=await this.request('GET','/users/me');
    if(parent?.type === 'database_id') {
      const database=await this.request('GET',`/databases/${parent.database_id}`);
      const sources=database.data_sources;
      if(!Array.isArray(sources) || !sources.length) throw new Error('目标数据库没有可用 data source；请核对数据库链接和连接的访问权限。');
      if(sources.length !== 1) throw new Error(`数据库包含多个 data source，请用 --data-source ID 或 NOTION_DATA_SOURCE_ID 明确选择：\n${sources.map(s=>`${s.name || '未命名'}：${s.id}`).join('\n')}`);
      parent={type:'data_source_id',data_source_id:normalizeId(sources[0].id)};
    }
    if(parent?.type === 'workspace' && user.bot?.owner?.type !== 'user') throw new Error('工作区顶层创建需要 PAT 或用户授权的公共连接；内部集成令牌不能用于此模式。请更换 token，或使用 --parent 创建独立子页面。');
    let titleProperty = 'title';
    if(parent?.type === 'page_id') await this.request('GET',`/pages/${parent.page_id}`);
    if(parent?.type === 'data_source_id') {
      const data=await this.request('GET',`/data_sources/${parent.data_source_id}`);
      titleProperty=Object.entries(data.properties || {}).find(([,value])=>value.type === 'title')?.[0];
      if(!titleProperty) throw new Error('目标 data source 没有可识别的 title 属性。');
    }
    return {user_id:user.id,workspace_name:user.bot?.workspace_name,resolved_parent:parent,title_property:titleProperty,max_file_size:user.bot?.workspace_limits?.max_file_upload_size_in_bytes};
  }
}

function writeReceipt(file, data) {
  const tmp=file+`.${process.pid}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
}

async function publish(plan,{client,receiptPath=plan.source+'.notion-upload.json',newPage=false}={}) {
  if(!plan.parent) throw new Error('上传需要 --parent / NOTION_PARENT_PAGE_ID、--database / NOTION_DATABASE_ID、--data-source / NOTION_DATA_SOURCE_ID 或 --workspace / NOTION_WORKSPACE_ROOT=true。');
  const lock=receiptPath+'.lock';
  let handle;
  try {handle=fs.openSync(lock,'wx');}catch{throw new Error(`存在上传锁：${lock}。确认没有其他上传进程并检查回执后再处理。`);}
  let receipt;
  try {
    const previous=fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath,'utf8')) : null;
    if(previous && !newPage) {
      if(previous.status === 'complete' && previous.sha256 === plan.sha256 && JSON.stringify(previous.parent) === JSON.stringify(plan.parent) && previous.title === plan.title) return {...previous,skipped:true};
      throw new Error(`已有上传回执（${previous.status}，${previous.url || previous.page_id || '创建结果待核查'}）。本版不覆盖旧页面；明确需要新版本时使用 --new-page。`);
    }
    // All read-only permission checks happen before the first remote write.
    const auth=await client.check(plan.parent);
    const resolvedParent=auth.resolved_parent || plan.parent;
    if(resolvedParent.type === 'database_id') throw new Error('数据库目标尚未解析为 data source，已停止上传。');
    if(auth.max_file_size && plan.assets.some(a=>a.size > auth.max_file_size)) throw new Error('图片超过当前 Notion 工作区的文件大小限制。');
    receipt={status:'uploading_images',source:plan.source,sha256:plan.sha256,title:plan.title,parent:plan.parent,resolved_parent:resolvedParent,uploads:[],top_level_blocks_written:0,...(previous ? {previous_page:previous.url || previous.page_id || null} : {})};
    writeReceipt(receiptPath,receipt);
    const imageIds=[];
    for(const asset of plan.assets) {
      if(createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex') !== asset.sha256) throw new Error('准备后图片已变化，请重新生成上传计划。');
      const upload=await client.request('POST','/file_uploads',{mode:'single_part',filename:path.basename(asset.path),content_type:asset.content_type});
      receipt.uploads.push({id:upload.id,file:path.basename(asset.path),status:'pending'});writeReceipt(receiptPath,receipt);
      const form=new FormData();form.set('file',new Blob([fs.readFileSync(asset.path)],{type:asset.content_type}),path.basename(asset.path));
      const sent=await client.request('POST',`/file_uploads/${encodeURIComponent(upload.id)}/send`,form);
      if(sent.status !== 'uploaded') throw new Error(`图片上传状态尚未完成：${sent.status}`);
      imageIds.push(upload.id);receipt.uploads.at(-1).status='uploaded';writeReceipt(receiptPath,receipt);
    }
    receipt.status='creating_page';writeReceipt(receiptPath,receipt);
    const page=await client.request('POST','/pages',{parent:resolvedParent,properties:{[auth.title_property]:{type:'title',title:splitText(plan.title)}}});
    receipt.page_id=page.id;receipt.url=page.url;receipt.status='writing_blocks';writeReceipt(receiptPath,receipt);
    function materialize(block) {
      const copy=structuredClone(block);
      if(copy.type === 'image' && copy.image.type === 'file_upload') {
        const match=/^LOCAL_IMAGE_(\d+)$/.exec(copy.image.file_upload.id);
        if(match) copy.image.file_upload.id=imageIds[Number(match[1])];
      }
      return copy;
    }
    async function append(parentId, items, topLevel=false) {
      let offset=0;
      while(offset < items.length) {
        const prepared=[];let bytes=0;
        for(const original of items.slice(offset,offset+50)) {
          const item=materialize(original);const data=item[item.type];
          // Tables require an initial row. Other children are written after parent IDs exist.
          if(item.type === 'table') data.children=data.children.slice(0,1);
          else delete data.children;
          const size=Buffer.byteLength(JSON.stringify(item));
          if(size > 450000) throw new Error('单个 Notion 块过大，请拆分笔记。');
          if(bytes+size > 450000) break;
          prepared.push(item);bytes+=size;
        }
        const result=await client.request('PATCH',`/blocks/${parentId}/children`,{children:prepared});
        if(result.results?.length !== prepared.length) throw new Error('Notion 返回的 block 数量不匹配，已停止。');
        for(let i=0;i<prepared.length;i++) {
          const original=items[offset+i];const children=original[original.type].children || [];
          await append(result.results[i].id,original.type === 'table' ? children.slice(1) : children);
        }
        offset+=prepared.length;
        if(topLevel){receipt.top_level_blocks_written=offset;writeReceipt(receiptPath,receipt);}
      }
    }
    await append(page.id,plan.blocks,true);
    receipt.status='complete';writeReceipt(receiptPath,receipt);return receipt;
  } catch(error) {
    if(receipt) {receipt.error=error.message;try{writeReceipt(receiptPath,receipt);}catch{} }
    throw new Error(`${error.message}${receipt?.url ? `\n部分页面：${receipt.url}` : ''}\n回执：${receiptPath}`);
  } finally {fs.closeSync(handle);fs.unlinkSync(lock);}
}

function loadEnv(file, env) {
  if(!file) return;
  for(const raw of fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if(!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const m=/^\s*(?:export\s+)?(NOTION_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(raw);
    if(!m) throw new Error('环境文件仅支持 NOTION_* 的 KEY=value 行。');
    let value=m[2];if((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
    env[m[1]] ??= value;
  }
}

async function main(argv=process.argv.slice(2), env={...process.env}) {
  const options={};let source;
  const flags={'--parent':'parent','--database':'database','--data-source':'dataSource','--env-file':'envFile','--title':'title','--plan':'planFile'};
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if(flags[arg]) {if(!argv[i+1] || argv[i+1].startsWith('--')) throw new Error(`${arg} 需要一个值。`);options[flags[arg]]=argv[++i];}
    else if(['--dry-run','--check-auth','--new-page','--workspace','--help'].includes(arg)) options[arg.slice(2)]=true;
    else if(arg.startsWith('-') || source) throw new Error(`未知或重复参数：${arg}`);
    else source=arg;
  }
  if(options.help){console.log('node scripts/upload-to-notion.cjs <note.md> [--parent URL_OR_ID | --database URL_OR_ID | --data-source ID | --workspace] [--env-file FILE] [--dry-run] [--plan FILE] [--title TITLE] [--new-page]\nnode scripts/upload-to-notion.cjs --check-auth [--env-file FILE] [--parent URL_OR_ID | --database URL_OR_ID | --data-source ID | --workspace]\nToken: NOTION_TOKEN; destination: NOTION_PARENT_PAGE_ID, NOTION_DATABASE_ID, NOTION_DATA_SOURCE_ID or NOTION_WORKSPACE_ROOT=true. Workspace root requires PAT/public connection. --dry-run never accesses Notion.');return;}
  loadEnv(options.envFile,env);
  const explicit=options.parent || options.database || options.dataSource || options.workspace;
  const parent=options.parent || (!explicit ? env.NOTION_PARENT_PAGE_ID : undefined);
  const database=options.database || (!explicit ? env.NOTION_DATABASE_ID : undefined);
  const dataSource=options.dataSource || (!explicit ? env.NOTION_DATA_SOURCE_ID : undefined);
  if(!explicit && env.NOTION_WORKSPACE_ROOT && !['true','false'].includes(env.NOTION_WORKSPACE_ROOT)) throw new Error('NOTION_WORKSPACE_ROOT 只能是 true 或 false。');
  const workspace=!!options.workspace || (!explicit && env.NOTION_WORKSPACE_ROOT === 'true');
  if([!!parent,!!database,!!dataSource,workspace].filter(Boolean).length > 1) throw new Error('父页面、数据库、data source、工作区顶层只能选择一个。');
  const destination=parent ? {type:'page_id',page_id:normalizeId(parent)} : database ? {type:'database_id',database_id:normalizeId(database)} : dataSource ? {type:'data_source_id',data_source_id:normalizeId(dataSource)} : workspace ? {type:'workspace',workspace:true} : null;
  if(options['check-auth']) {
    if(options['dry-run']) throw new Error('--check-auth 与 --dry-run 不能同时使用。');
    if(!env.NOTION_TOKEN) throw new Error('缺少 NOTION_TOKEN，请在本地环境变量或 --env-file 中配置。');
    const checked=await new NotionClient(env.NOTION_TOKEN).check(destination);
    console.log(JSON.stringify({authenticated:true,user_id:checked.user_id,workspace_name:checked.workspace_name,destination_checked:!!destination && !workspace,resolved_parent:checked.resolved_parent,workspace_root_requested:workspace,title_property:checked.title_property},null,2));return;
  }
  if(!source) throw new Error('请提供 Markdown 笔记路径；用 --help 查看参数。');
  const plan=buildPlan(source,{title:options.title,parent,database,dataSource,workspace});
  if(options.planFile) {
    const target=path.resolve(options.planFile);
    if(fs.existsSync(target)) throw new Error('--plan 不覆盖已有文件，请另选路径。');
    fs.writeFileSync(target,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  }
  if(options['dry-run']) {console.log(JSON.stringify({dry_run:true,title:plan.title,blocks:plan.block_count,local_images:plan.assets.map(a=>({file:a.path,bytes:a.size})),parent:plan.parent,warnings:plan.warnings},null,2));return;}
  if(!env.NOTION_TOKEN) throw new Error('缺少 NOTION_TOKEN；可先用 --dry-run 检查本地内容。');
  const result=await publish(plan,{client:new NotionClient(env.NOTION_TOKEN),newPage:!!options['new-page']});
  console.log(JSON.stringify({status:result.status,skipped:!!result.skipped,url:result.url,receipt:plan.source+'.notion-upload.json',warnings:plan.warnings},null,2));
}

module.exports={buildPlan,normalizeId,NotionClient,publish,loadEnv,main};
if(require.main === module) main().catch(error=>{
  // Never echo credentials, even if a local config error happens to contain one.
  let message=error.message;
  if(process.env.NOTION_TOKEN) message=message.replaceAll(process.env.NOTION_TOKEN,'[REDACTED]');
  console.error(message);process.exitCode=1;
});
