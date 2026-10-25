'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flamme-'));
process.env.FLAMME_DATA = dataDir;

const { app } = require('../server');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(180, 9)]);

function cookieOf(res) {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  const found = all.find((line) => line.startsWith('flamme='));
  assert.ok(found, 'cookie de session manquant');
  return found.split(';')[0];
}

test('un groupe dépose, la flamme s’allume, un étranger reste dehors', async () => {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(pathname, { method = 'GET', cookie, json, form } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (json) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    if (form) body = form;
    const res = await fetch(base + pathname, { method, headers, body });
    const text = await res.text();
    let data = {};
    if (text) data = JSON.parse(text);
    return { status: res.status, data, res };
  }

  async function upload(cookie, streakId, caption) {
    const form = new FormData();
    form.append('caption', caption);
    form.append('media', new Blob([JPEG], { type: 'image/jpeg' }), 'photo.jpg');
    return call(`/api/streaks/${streakId}/drops`, { method: 'POST', cookie, form });
  }

  try {
    const bad = await call('/api/register', { method: 'POST', json: { name: 'A', password: '1234' } });
    assert.equal(bad.status, 400);

    const mila = await call('/api/register', { method: 'POST', json: { name: 'Mila', password: 'secret' } });
    assert.equal(mila.status, 201);
    const cookieMila = cookieOf(mila.res);

    const wrong = await call('/api/login', { method: 'POST', json: { name: 'Mila', password: 'nope' } });
    assert.equal(wrong.status, 401);

    const created = await call('/api/streaks', { method: 'POST', cookie: cookieMila, json: { title: 'Noah' } });
    assert.equal(created.status, 201);
    assert.equal(created.data.streak.status, 'solo');
    assert.equal(created.data.streak.code.length, 6);
    const streakId = created.data.streak.id;

    const first = await upload(cookieMila, streakId, 'salut');
    assert.equal(first.status, 201);
    assert.equal(first.data.streak.status, 'solo');
    assert.equal(first.data.streak.count, 0);

    const noah = await call('/api/register', { method: 'POST', json: { name: 'Noah', password: 'secret' } });
    const cookieNoah = cookieOf(noah.res);
    const joined = await call('/api/streaks/join', {
      method: 'POST',
      cookie: cookieNoah,
      json: { code: ` ${created.data.streak.code.toLowerCase()} ` },
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.streak.label, 'Mila');
    assert.equal(joined.data.streak.status, 'waiting_you');

    const second = await upload(cookieNoah, streakId, 'moi aussi');
    assert.equal(second.status, 201);
    assert.equal(second.data.streak.status, 'lit');
    assert.equal(second.data.streak.count, 1);
    assert.equal(second.data.streak.best, 1);

    const seenByMila = await call(`/api/streaks/${streakId}`, { cookie: cookieMila });
    assert.equal(seenByMila.data.status, 'lit');
    assert.equal(seenByMila.data.count, 1);
    assert.equal(seenByMila.data.partner.name, 'Noah');
    assert.ok(seenByMila.data.prompt.title);
    assert.ok(seenByMila.data.cover);
    assert.equal(seenByMila.data.recent.length, 2);
    const todayCell = seenByMila.data.month.find((day) => day.day === seenByMila.data.today);
    assert.equal(todayCell.state, 'lit');
    assert.ok(seenByMila.data.month.length >= 28);

    const noahDrop = second.data.streak.youDrop.id;
    const reacted = await call(`/api/drops/${noahDrop}/reaction`, { method: 'POST', cookie: cookieMila });
    assert.equal(reacted.status, 200);
    const noahCard = reacted.data.streak.members.find((member) => member.name === 'Noah');
    assert.equal(noahCard.drop.reactions.length, 1);
    assert.equal(noahCard.drop.reactions[0].name, 'Mila');
    assert.equal(noahCard.drop.reactions[0].you, true);
    const own = await call(`/api/drops/${seenByMila.data.youDrop.id}/reaction`, { method: 'POST', cookie: cookieMila });
    assert.equal(own.status, 400);
    const cleared = await call(`/api/drops/${noahDrop}/reaction`, { method: 'POST', cookie: cookieMila });
    assert.equal(cleared.status, 200);
    const noahAgain = cleared.data.streak.members.find((member) => member.name === 'Noah');
    assert.equal(noahAgain.drop.reactions.length, 0);

    const replaced = await upload(cookieMila, streakId, 'mieux');
    assert.equal(replaced.status, 201);
    assert.equal(replaced.data.streak.count, 1);
    assert.notEqual(replaced.data.streak.youDrop.id, seenByMila.data.youDrop.id);

    const dropId = replaced.data.streak.youDrop.id;
    const ownMedia = await fetch(`${base}/api/media/${dropId}`, { headers: { cookie: cookieMila } });
    assert.equal(ownMedia.status, 200);
    assert.equal(ownMedia.headers.get('content-type'), 'image/jpeg');

    const lina = await call('/api/register', { method: 'POST', json: { name: 'Lina', password: 'secret' } });
    const cookieLina = cookieOf(lina.res);
    const joinedLina = await call('/api/streaks/join', {
      method: 'POST',
      cookie: cookieLina,
      json: { code: created.data.streak.code },
    });
    assert.equal(joinedLina.status, 200);
    assert.equal(joinedLina.data.streak.memberCount, 3);
    assert.equal(joinedLina.data.streak.status, 'waiting_you');

    const sam = await call('/api/register', { method: 'POST', json: { name: 'Sam', password: 'secret' } });
    const cookieSam = cookieOf(sam.res);
    const hidden = await call(`/api/streaks/${streakId}`, { cookie: cookieSam });
    assert.equal(hidden.status, 404);
    const outsideReact = await call(`/api/drops/${noahDrop}/reaction`, { method: 'POST', cookie: cookieSam });
    assert.equal(outsideReact.status, 404);
    const stolen = await fetch(`${base}/api/media/${second.data.streak.youDrop.id}`, {
      headers: { cookie: cookieSam },
    });
    assert.equal(stolen.status, 404);
    const anon = await fetch(`${base}/api/media/${dropId}`);
    assert.equal(anon.status, 401);

    const duplicate = await call('/api/register', { method: 'POST', json: { name: 'mila', password: 'autre' } });
    assert.equal(duplicate.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
