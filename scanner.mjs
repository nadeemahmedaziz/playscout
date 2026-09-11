import fs from 'node:fs/promises';
import gplay from '@mradex77/google-play-scraper';

const output = new URL('./docs/data/games.json', import.meta.url);
const categories = [
  'GAME','GAME_ACTION','GAME_ADVENTURE','GAME_ARCADE','GAME_BOARD','GAME_CARD',
  'GAME_CASINO','GAME_CASUAL','GAME_EDUCATIONAL','GAME_MUSIC','GAME_PUZZLE',
  'GAME_RACING','GAME_ROLE_PLAYING','GAME_SIMULATION','GAME_SPORTS','GAME_STRATEGY',
  'GAME_TRIVIA','GAME_WORD'
];
const collections = ['TOP_FREE','TOP_PAID','GROSSING'];
const ids = new Set();

let previous = { games: [] };
try { previous = JSON.parse(await fs.readFile(output, 'utf8')); } catch {}
const all = new Map((previous.games || []).map(game => [game.appId, game]));

for (const categoryName of categories) {
  for (const collectionName of collections) {
    try {
      const list = await gplay.list({
        category: gplay.category[categoryName],
        collection: gplay.collection[collectionName],
        num: 200, country: 'us', lang: 'en', throttle: 2
      });
      for (const item of list) if (item.appId) ids.add(item.appId);
    } catch (error) {
      console.warn(`${categoryName}/${collectionName}: ${error.message}`);
    }
  }
}

console.log(`Discovered ${ids.size} unique candidates.`);
const appIds = [...ids];
for (let start = 0; start < appIds.length; start += 250) {
  const result = await gplay.apps({
    appIds: appIds.slice(start, start + 250), concurrency: 5,
    country: 'us', lang: 'en', throttle: 2
  });
  for (const row of result) {
    if (row.status !== 'fulfilled') continue;
    const app = row.app;
    const released = toISO(app.released);
    if (!released || !app.genreId?.startsWith('GAME')) continue;
    all.set(app.appId, {
      appId: app.appId, name: app.title, developer: app.developer,
      category: app.genre || 'Game', initialReleaseDate: released,
      icon: app.icon || '', url: app.url,
      score: app.score ?? null, installs: app.installs || '',
      lastSeenAt: new Date().toISOString()
    });
  }
  console.log(`Checked ${Math.min(start + 250, appIds.length)}/${appIds.length}`);
}

const payload = {
  updatedAt: new Date().toISOString(),
  games: [...all.values()].sort((a,b) => b.initialReleaseDate.localeCompare(a.initialReleaseDate))
};
await fs.writeFile(output, JSON.stringify(payload, null, 2));
console.log(`Saved ${payload.games.length} indexed games.`);

function toISO(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0,10);
}
