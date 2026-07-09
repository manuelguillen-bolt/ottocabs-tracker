#!/usr/bin/env node
/**
 * Build de la versión pública (flotas) del OttoCabs Fleet Agreement Tracker.
 * - Lee la lista de flotas del Google Sheet "Madrid Grouping" (FO = OTTOCABS)
 * - Ejecuta las MISMAS queries del dashboard (extraídas de fleet-template.html) contra Databricks
 * - Inyecta los datos (solo julio 2026 en adelante, a día vencido) y publica docs/index.html
 * Variables de entorno requeridas:
 *   DATABRICKS_HOST  p.ej. https://bolt.cloud.databricks.com
 *   DATABRICKS_TOKEN token de acceso (solo lectura)
 *   DATABRICKS_WAREHOUSE_ID  id del SQL Warehouse
 *   SHEET_CSV_URL    URL de exportación CSV del sheet Madrid Grouping
 */
const fs=require('fs');

const HOST=process.env.DATABRICKS_HOST,TOKEN=process.env.DATABRICKS_TOKEN,
      WH=process.env.DATABRICKS_WAREHOUSE_ID,SHEET=process.env.SHEET_CSV_URL;
const DRY=process.argv.includes('--dry-run');
if(!DRY&&(!HOST||!TOKEN||!WH||!SHEET)){console.error('Faltan variables de entorno');process.exit(1);}

// ---------- 1. Plantilla y extracción de las queries (única fuente de verdad) ----------
const tpl=fs.readFileSync('fleet-template.html','utf8');
function seg(re,name){const m=tpl.match(re);if(!m){console.error('No se pudo extraer '+name);process.exit(1);}return m[0];}
const peak=seg(/const PEAK_CASE=`[^`]+`;/,'PEAK_CASE');
const regions=seg(/const REGION_M30=\d+, REGION_AIR=\d+;/,'REGIONES');
const qStart=tpl.indexOf('function qKpi(');
const qEndAnchor='ORDER BY a.oh DESC LIMIT 400`;}';
const qEnd=tpl.indexOf(qEndAnchor)+qEndAnchor.length;
if(qStart<0||qEnd<qStart){console.error('No se pudieron extraer las queries');process.exit(1);}
const fns=tpl.slice(qStart,qEnd);
const makeQueries=OTTO=>new Function('OTTO',peak+fns+';return {qKpi,qDailyGmv,qDailyOh,qCars,qDrv};')(OTTO);

// ---------- 2. Fechas (Europe/Madrid, a día vencido) ----------
const todayMadrid=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
const D=s=>new Date(s+'T12:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const addD=(s,n)=>{const d=D(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
const yesterday=addD(todayMadrid,-1);
function monthRange(m){
  const [y,mm]=m.split('-').map(Number);
  const last=new Date(Date.UTC(y,mm,0)).getUTCDate();
  const start=`${m}-01`;
  let end=`${m}-${String(last).padStart(2,'0')}`;if(end>yesterday)end=yesterday;
  const dow=s=>(D(s).getUTCDay()+6)%7;
  const fs_=addD(start,-dow(start)-7); // semana previa extra para WoW
  let fe=addD(`${m}-${String(last).padStart(2,'0')}`,6-dow(`${m}-${String(last).padStart(2,'0')}`));
  if(fe>yesterday)fe=yesterday;
  return{start,end,fetchStart:fs_,fetchEnd:fe};
}
const months=[];
{let y=2026,m=7;const cur=yesterday.slice(0,7);
 while(true){const k=`${y}-${String(m).padStart(2,'0')}`;if(k>cur)break;if(`${k}-01`<=yesterday)months.push(k);m++;if(m>12){m=1;y++;}}}
console.log('Meses a publicar:',months.join(', '),'| datos hasta',yesterday);

// ---------- 3. CSV del sheet → company IDs de OttoCabs ----------
function parseCSV(t){const R=[];let r=[],c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];
 if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++;}else q=false;}else c+=ch;}
 else if(ch==='"')q=true;else if(ch===','){r.push(c);c='';}
 else if(ch==='\n'){r.push(c);R.push(r);r=[];c='';}else if(ch!=='\r')c+=ch;}
 if(c!==''||r.length){r.push(c);R.push(r);}return R;}
const SENTINELS=['169633','169628','169630','169631'];
async function fleetList(){
  const csv=await (await fetch(SHEET)).text();
  const ids=[...new Set(parseCSV(csv).filter(r=>/^\d+$/.test((r[1]||'').trim())&&(r[2]||'').toUpperCase().includes('OTTOCABS')).map(r=>r[1].trim()))];
  const sent=SENTINELS.filter(x=>ids.includes(x)).length;
  if(ids.length<15||sent<2){console.error(`Lista de flotas sospechosa (${ids.length} ids, ${sent} centinelas). Abortando para no publicar datos erróneos.`);process.exit(1);}
  console.log(`Flotas OttoCabs: ${ids.length} companies (desde el sheet)`);
  return ids.join(',');
}

// ---------- 4. Databricks SQL Statement Execution API ----------
async function sql(q){
  const H={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'};
  let r=await (await fetch(`${HOST}/api/2.0/sql/statements`,{method:'POST',headers:H,
    body:JSON.stringify({statement:q,warehouse_id:WH,wait_timeout:'30s',on_wait_timeout:'CONTINUE',format:'JSON_ARRAY',disposition:'INLINE'})})).json();
  const t0=Date.now();
  while(r.status&&['PENDING','RUNNING'].includes(r.status.state)){
    if(Date.now()-t0>180000)throw new Error('timeout');
    await new Promise(res=>setTimeout(res,3000));
    r=await (await fetch(`${HOST}/api/2.0/sql/statements/${r.statement_id}`,{headers:H})).json();
  }
  if(!r.status||r.status.state!=='SUCCEEDED')throw new Error('SQL '+JSON.stringify(r.status||r).slice(0,400));
  const cols=r.manifest.schema.columns.map(c=>c.name);
  return (r.result&&r.result.data_array||[]).map(row=>{const o={};cols.forEach((c,i)=>o[c]=row[i]);return o;});
}

// ---------- 5. Construcción ----------
(async()=>{
  if(DRY){const Q=makeQueries('1,2,3');console.log('DRY RUN — qKpi:\n',Q.qKpi('2026-07-01','2026-07-05').slice(0,180));
    console.log('rangos julio:',JSON.stringify(monthRange('2026-07')));return;}
  const OTTO=await fleetList();
  const Q=makeQueries(OTTO);
  const BAKED={};
  for(const m of months){
    const{start,end,fetchStart,fetchEnd}=monthRange(m);
    console.log('Mes',m,start,'→',end);
    const [kpi,dg,doh,cars,drv]=await Promise.all([
      sql(Q.qKpi(start,end)),sql(Q.qDailyGmv(fetchStart,fetchEnd)),sql(Q.qDailyOh(fetchStart,fetchEnd)),
      sql(Q.qCars(start,end)),sql(Q.qDrv(start,end))
    ]);
    BAKED[m]=[kpi,dg,doh,cars,drv,[],[]];
    console.log(`  kpi=${kpi.length} daily=${dg.length}/${doh.length} coches=${cars.length} conductores=${drv.length}`);
  }
  const cfg=`<script>window.BAKED=${JSON.stringify(BAKED)};window.BAKED_DATE=${JSON.stringify(yesterday)};</script>`;
  const out=tpl.replace('<!--BAKED_HERE-->',cfg);
  fs.mkdirSync('docs',{recursive:true});
  fs.writeFileSync('docs/index.html',out);
  console.log('docs/index.html generado:',out.length,'bytes');
})().catch(e=>{console.error(e);process.exit(1);});
