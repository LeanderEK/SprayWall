import { assert, test } from './harness.js';

// Checks on the site as a whole: that everything the app needs is saved for offline use, and nothing private is in it.

async function siteFiles() {
  const response = await fetch('/__files');
  assert.ok(response.ok, 'the test server lists the files of the site');
  return (await response.json()).map((name) => name.replace(/\\/g, '/'));
}

async function precacheList() {
  const source = await (await fetch('/site/sw.js')).text();
  const match = source.match(/const ASSETS = (\[[\s\S]*?\]);/);
  assert.ok(match, 'sw.js has a list called ASSETS');
  return JSON.parse(match[1].replace(/,\s*\]/, ']'));
}

test('offline: the service worker saves every file of the site, so nothing is missing without signal', async () => {
  const files = (await siteFiles()).filter((name) => name !== 'sw.js');
  const saved = (await precacheList()).filter((name) => name !== './').map((name) => name.replace(/^\.\//, ''));
  const missing = files.filter((name) => !saved.includes(name));
  const extra = saved.filter((name) => !files.includes(name));
  assert.eq(missing, [], 'files the offline list forgets');
  assert.eq(extra, [], 'files on the offline list that do not exist');
});

test('offline: the page, the manifest and the icons all exist and are linked with relative paths', async () => {
  const html = await (await fetch('/site/index.html')).text();
  assert.ok(html.includes('manifest.webmanifest'));
  assert.ok(html.includes('apple-touch-icon'));
  assert.ok(!/(href|src)="\//.test(html), 'no address starts with a slash, so the app works from any folder of a web host');
  const manifest = await (await fetch('/site/manifest.webmanifest')).json();
  assert.eq(manifest.display, 'standalone');
  assert.ok(manifest.start_url.startsWith('.'), 'start_url is relative');
  for (const icon of manifest.icons) assert.ok((await fetch('/site/' + icon.src)).ok, `${icon.src} exists`);
  assert.ok((await fetch('/site/icons/apple-touch-icon.png')).ok);
});

test('privacy: nothing from the private folder is part of the site', async () => {
  const files = await siteFiles();
  assert.ok(files.every((name) => !/\.(zip|spraywall)$/i.test(name) && !name.startsWith('private/') && !name.startsWith('dev/')), 'no packs or private files in site/');
  assert.ok(files.every((name) => !/wall.*\.(jpg|jpeg)$/i.test(name)), 'no wall photo in site/');
});

test('code: the site never builds HTML from text it was given (shared climbs are strangers\' text)', async () => {
  const files = (await siteFiles()).filter((name) => name.endsWith('.js') && name !== 'sw.js');
  for (const name of files) {
    const source = await (await fetch('/site/' + name)).text();
    assert.ok(!/\.innerHTML\s*=/.test(source) && !/insertAdjacentHTML|document\.write|eval\(/.test(source), `${name} writes HTML or evaluates text`);
  }
});
