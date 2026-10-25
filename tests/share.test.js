import { assert, test } from './harness.js';
import {
  FORMAT, MAX_NAME, ShareError, extractPayload, linkFor, makeShare, packShare, parseShare, shareToText, unpackShare,
} from '../site/src/domain/share.js';

const NOW = 1_800_000_000_000;
const wall = { key: 'home-wall', name: 'Home wall' };
const climb = (over = {}) => ({
  id: 'b1f3c0de-1111-4222-8333-444455556666',
  name: 'Swoobap',
  grade: 6,
  comment: 'Directional holds.\nSomewhat powerful.',
  author: 'Zeke',
  holds: '122:hand,159:hand,386:start,595:finish',
  createdAt: NOW - 5000,
  updatedAt: NOW - 1000,
  ...over,
});
const withClimbs = (...climbs) => ({ format: FORMAT, version: 1, wall, climbs });

test('share: a file round trips exactly', () => {
  const text = shareToText(makeShare(wall, [climb(), climb({ id: 'second-climb-id-0002', name: 'Slab', grade: null })]));
  const parsed = parseShare(text, NOW);
  assert.eq(parsed.wallKey, 'home-wall');
  assert.eq(parsed.wallName, 'Home wall');
  assert.eq(parsed.climbs.length, 2);
  assert.eq(parsed.climbs[0], climb());
  assert.eq(parsed.climbs[1].grade, null);
  assert.eq(parsed.skipped, 0);
});

test('share: only the shared fields leave the phone', () => {
  const extra = climb({ secret: 'no', wallKey: 'x', deletedAt: 5 });
  const share = makeShare(wall, [extra]);
  assert.eq(Object.keys(share.climbs[0]).sort(), ['author', 'comment', 'createdAt', 'grade', 'holds', 'id', 'name', 'updatedAt']);
});

test('share: rejects things that are not climb files, with readable messages', () => {
  assert.throws(() => parseShare('{nope', NOW), 'not a SprayWall climbs file');
  assert.throws(() => parseShare('[]', NOW), 'not a SprayWall climbs file');
  assert.throws(() => parseShare({ format: 'something-else', version: 1 }, NOW), 'not a SprayWall climbs file');
  assert.throws(() => parseShare({ ...withClimbs(climb()), version: 2 }, NOW), 'newer version');
  assert.throws(() => parseShare({ ...withClimbs(climb()), wall: { name: 'x' } }, NOW), 'which wall');
  assert.throws(() => parseShare({ ...withClimbs(climb()), wall: { key: '../../etc' } }, NOW), 'which wall');
  assert.throws(() => parseShare(withClimbs(), NOW), 'no climbs');
  assert.throws(() => parseShare(withClimbs({ id: 'x' }), NOW), 'could be read');
});

test('share: climbs that cannot be used are skipped, the rest kept', () => {
  const parsed = parseShare(
    withClimbs(
      climb(),
      climb({ id: 'short' }), // id too short
      climb({ id: 'no-holds-0001', holds: 'junk' }),
      climb({ id: 'no-name-00002', name: '   ' }),
      climb(), // duplicate id
    ),
    NOW,
  );
  assert.eq(parsed.climbs.length, 1);
  assert.eq(parsed.skipped, 4);
});

test('share: everything from a stranger is cleaned: text capped, numbers forced into range', () => {
  const nasty = climb({
    name: `<img src=x onerror=alert(1)>${'n'.repeat(500)}`,
    comment: `\u0000\u0007hello\u001f ${'c'.repeat(5000)}`,
    author: 'a'.repeat(300),
    grade: 99,
    stars: 5, // an old file's rating: not taken
    holds: '3:hand,3:foot,7:wobble, 9:start,-4:hand,x:hand',
    createdAt: NOW * 5,
    updatedAt: NOW * 5,
  });
  const [out] = parseShare(withClimbs(nasty), NOW).climbs;
  assert.eq(out.name.length, MAX_NAME);
  assert.ok(out.name.startsWith('<img src=x onerror=alert(1)>'), 'text is kept as text, not removed or run');
  assert.ok(!/[\u0000-\u0008\u001f]/.test(out.comment));
  assert.ok(out.comment.startsWith('hello'));
  assert.eq(out.comment.length, 2000);
  assert.eq(out.author.length, 40);
  assert.eq(out.grade, null);
  assert.ok(!('stars' in out), 'a rating in a file is not taken: a rating belongs to each person');
  assert.eq(out.holds, '3:foot,9:start'); // the later entry for hold 3 wins; unreadable ones are dropped
  assert.ok(out.updatedAt <= NOW + 24 * 3600 * 1000, 'a date in the far future is held to tomorrow at the latest');
  assert.ok(out.createdAt <= out.updatedAt);
});

test('share: missing numbers and dates get sensible values', () => {
  const [out] = parseShare(withClimbs({ id: 'plain-climb-001', name: 'Bare', holds: '1:hand' }), NOW).climbs;
  assert.eq([out.grade, out.comment, out.author], [null, '', '']);
  assert.eq([out.createdAt, out.updatedAt], [NOW, NOW]);
});

test('link: a climb survives being packed into a link and opened again', async () => {
  const payload = await packShare(makeShare(wall, [climb()]));
  assert.ok(/^[zj][A-Za-z0-9_-]+$/.test(payload), 'only letters, digits, - and _');
  const link = linkFor('https://example.com/spraywall/index.html', payload);
  assert.ok(link.startsWith('https://example.com/spraywall/index.html#/import/'));
  assert.ok(link.length < 700, `a one-climb link should be short, it is ${link.length} characters`);
  const parsed = await unpackShare(link, NOW);
  assert.eq(parsed.climbs[0], climb());
  assert.eq(parsed.wallKey, 'home-wall');
});

test('link: it also works when only the code is pasted, with stray spaces and line breaks', async () => {
  const payload = await packShare(makeShare(wall, [climb()]));
  const messy = `  ${payload.slice(0, 30)}\n${payload.slice(30)}  `;
  assert.eq((await unpackShare(messy, NOW)).climbs[0].name, 'Swoobap');
  const withText = `Check this out! https://x.test/app/#/import/${payload}`;
  assert.eq((await unpackShare(withText, NOW)).climbs[0].name, 'Swoobap');
});

test('link: words, full stops and brackets around a link are not mistaken for part of it', async () => {
  const payload = await packShare(makeShare(wall, [climb()]));
  const link = `https://x.test/app/#/import/${payload}`;
  for (const message of [`Try this one! ${link} it is hard`, `${link}.`, `(${link})`, `${link}
See you at 6`, `look: ${link}, bring chalk`]) {
    assert.eq((await unpackShare(message, NOW)).climbs[0].name, 'Swoobap', message.slice(0, 20));
  }
});

test('link: damaged or unrelated text gives a readable error', async () => {
  await assert.rejects(unpackShare('hello there', NOW), 'does not look like');
  await assert.rejects(unpackShare('', NOW), 'does not look like');
  await assert.rejects(unpackShare('https://example.com/', NOW), 'does not look like');
  const payload = await packShare(makeShare(wall, [climb()]));
  await assert.rejects(unpackShare(payload.slice(0, 40), NOW), 'damaged');
  await assert.rejects(unpackShare('zAAAAAAAAAAAAAAAA', NOW), 'damaged');
  await assert.rejects(unpackShare('j' + btoa('{"format":"nope"}').replace(/=+$/, ''), NOW), 'not a SprayWall climbs file');
  assert.throws(() => extractPayload('#/import/'), 'does not look like');
});

test('link: a link that unpacks into gigabytes is refused, not followed', async () => {
  const zeros = new Uint8Array(5_000_000);
  const squeezed = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let binary = '';
  for (const b of squeezed) binary += String.fromCharCode(b);
  const payload = 'z' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.ok(payload.length < 20000, 'the bomb itself is small');
  await assert.rejects(unpackShare(payload, NOW), 'too long');
});

test('link: several climbs fit in one link', async () => {
  const many = Array.from({ length: 12 }, (_, i) => climb({ id: `climb-number-${String(i).padStart(4, '0')}`, name: `Problem ${i}` }));
  const parsed = await unpackShare(await packShare(makeShare(wall, many)), NOW);
  assert.eq(parsed.climbs.length, 12);
  assert.ok(ShareError.name === 'ShareError');
});
