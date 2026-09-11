import fs from 'node:fs/promises';
import path from 'node:path';
import gplay from '@mradex77/google-play-scraper';

const ROOT = process.cwd();
const DB_FILE = path.join(ROOT, 'data/games.json');
const PUBLIC_FILE = path.join(ROOT, 'docs/data/games.json');
const mode = (process.env.SCAN_MODE || 'normal').toLowerCase();
const allCountries = mode === 'deep'
  ? ['us','gb','ca','au','de','fr','br','mx','in','pk','id','tr','sa','jp','kr']
  : ['us','gb','ca','au','in','pk'];
// Scheduled runs rotate shards; eight runs cover the whole discovery matrix daily.
const slot = Math.floor(new Date().getUTCHours()/3) % 8;
const countries = mode === 'deep' ? allCountries : allCountries.filter((_,i)=>i%3===slot%3);
const categories = [
  'GAME_ACTION','GAME_ADVENTURE','GAME_ARCADE','GAME_BOARD','GAME_CARD',
  'GAME_CASINO','GAME_CASUAL','GAME_EDUCATIONAL','GAME_MUSIC','GAME_PUZZLE',
  'GAME_RACING','GAME_ROLE_PLAYING','GAME_SIMULATION','GAME_SPORTS',
  'GAME_STRATEGY','GAME_TRIVIA','GAME_WORD'
];
const baseTerms = [
  'new game','new games','game','games','3d game','offline game','online game','mobile game',
  'action game','adventure game','arcade game','board game','card game','casino game',
  'casual game','educational game','music game','puzzle game','racing game','role playing game',
  'simulation game','sports game','strategy game','trivia game','word game','match 3','sort puzzle',
  'merge game','idle game','runner game','tycoon game','escape game','brain game','color game',
  'block game','car game','football game','cricket game','shooting game','war game','rpg game',
  'kids game','girls game','boys game','parking game','driving game','cooking game','dress up game',
  'farm game','city game','construction game','stickman game','monster game','zombie game'
];
const deepExtra = ['arrow','thread','ball','bottle','bus','bike','truck','train','plane','robot','hero','battle','quest','tower','defense','survival','craft','build','dig','draw','tap','pop','blast','run','jump','race','match','sort','merge','escape','parking','simulator','puzzle','idle','tycoon','.io','2d','3d','offline','multiplayer'];
const terms = mode === 'deep' ? [...new Set([...baseTerms, ...deepExtra])] : baseTerms;
const delay = ms => new Promise(r => setTimeout(r, ms));
const isoDate = value => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
};
async function retry(fn, attempts=3) {
  let last;
  for (let i=0;i<attempts;i++) {
    try { return await fn(); } catch (e) { last=e; await delay(1000 * (i+1)); }
  }
  throw last;
}
async function readDb() {
  try { return JSON.parse(await fs.readFile(DB_FILE,'utf8')); }
  catch { return {generatedAt:null,scan:{},games:[]}; }
}
const idsFrom = rows => (rows || []).map(x => x.appId).filter(Boolean);
async function discoverCountry(country, candidateIds, errors) {
  const runCategories = mode === 'deep' ? categories : categories.filter((_,i)=>i%8===slot);
  const runTerms = mode === 'deep' ? terms : terms.filter((_,i)=>i%8===slot);
  for (const categoryName of runCategories) {
    const category = gplay.category?.[categoryName] || categoryName;
    for (const collectionName of ['TOP_FREE','TOP_PAID','GROSSING']) {
      try {
        const collection = gplay.collection?.[collectionName] || collectionName;
        const rows = await retry(() => gplay.list({category,collection,num:500,country,lang:'en'}),2);
        idsFrom(rows).forEach(id => candidateIds.add(id));
      } catch(e) { errors.push(`${country}/${categoryName}/${collectionName}: ${e.message}`); }
      await delay(220);
    }
  }
  for (const term of runTerms) {
    try {
      const rows = await retry(() => gplay.search({term,num:250,country,lang:'en'}),2);
      idsFrom(rows).forEach(id => candidateIds.add(id));
    } catch(e) { errors.push(`${country}/search/${term}: ${e.message}`); }
    await delay(240);
  }
}
async function mapLimit(items, limit, worker) {
  let cursor=0;
  async function run() { while (cursor < items.length) { const i=cursor++; await worker(items[i],i); } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
}
async function main() {
  const db = await readDb();
  const old = new Map((db.games || []).map(x => [x.appId,x]));
  const candidates = new Set();
  const errors=[];
  for (const country of countries) await discoverCountry(country,candidates,errors);

  // Network expansion: re-scan developers and similar apps for recently discovered games.
  const seeds = [...old.values()].sort((a,b)=>(b.firstSeen||'').localeCompare(a.firstSeen||'')).slice(0, mode==='deep'?500:120);
  for (const seed of seeds) {
    if (seed.developerId) {
      try { idsFrom(await retry(() => gplay.developer({devId:seed.developerId,country:'us',lang:'en'}),2)).forEach(x=>candidates.add(x)); }
      catch(e) { errors.push(`developer/${seed.developerId}: ${e.message}`); }
    }
    if (mode === 'deep') {
      try { idsFrom(await retry(() => gplay.similar({appId:seed.appId,country:'us',lang:'en'}),2)).forEach(x=>candidates.add(x)); }
      catch(e) { errors.push(`similar/${seed.appId}: ${e.message}`); }
    }
    await delay(180);
  }

  const stale=[...old.values()].filter(x=>!x.lastVerified || Date.now()-new Date(x.lastVerified).getTime()>7*86400000).map(x=>x.appId);
  const fresh=[...candidates].filter(id=>!old.has(id));
  const known=[...candidates].filter(id=>old.has(id));
  const maxDetails=mode==='deep'?8000:3000;
  const ids=[...new Set([...fresh,...known,...stale])].slice(0,maxDetails);
  let verified=0;
  await mapLimit(ids, 4, async appId => {
    try {
      const a = await retry(() => gplay.app({appId,country:'us',lang:'en'}),3);
      const genreId = String(a.genreId || '');
      if (!(genreId.startsWith('GAME') || String(a.genre||'').toLowerCase().includes('game'))) return;
      const released = isoDate(a.released);
      if (!released) return;
      const previous=old.get(appId)||{};
      old.set(appId,{
        appId,title:a.title||previous.title||appId,developer:a.developer||'',developerId:a.developerId||'',
        category:a.genre||'Game',categoryId:genreId||'GAME',released,
        icon:a.icon||'',url:a.url||`https://play.google.com/store/apps/details?id=${appId}`,
        free:Boolean(a.free),price:a.priceText||'',score:a.score??null,ratings:a.ratings??0,
        installs:a.installs||'',country:'us',firstSeen:previous.firstSeen||new Date().toISOString(),
        lastVerified:new Date().toISOString()
      });
      verified++;
    } catch(e) { errors.push(`app/${appId}: ${e.message}`); }
    await delay(120);
  });

  let games=[...old.values()].sort((a,b)=>b.released.localeCompare(a.released)||a.title.localeCompare(b.title));
  const from=process.env.FROM_DATE, to=process.env.TO_DATE;
  if (mode==='backfill' && from && to) {
    // Catalog remains complete; dates are recorded in scan metadata for dashboard verification.
    console.log(`Backfill verification requested: ${from} to ${to}`);
  }
  const output={
    generatedAt:new Date().toISOString(),
    scan:{status:errors.length?'completed-with-warnings':'completed',mode,slot,countries,discovered:candidates.size,candidates:ids.length,verified,totalStored:games.length,from:from||null,to:to||null,errors:errors.slice(0,100)},
    games
  };
  await fs.mkdir(path.dirname(DB_FILE),{recursive:true});
  await fs.mkdir(path.dirname(PUBLIC_FILE),{recursive:true});
  const json=JSON.stringify(output,null,2)+'\n';
  await fs.writeFile(DB_FILE,json);
  await fs.writeFile(PUBLIC_FILE,json);
  console.log(`PlayScout: ${ids.length} candidates, ${verified} verified, ${games.length} stored, ${errors.length} warnings.`);
}
main().catch(e=>{console.error(e);process.exit(1)});
