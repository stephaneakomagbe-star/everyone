'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, promptFor, PROMPTS } = require('../lib/day');
const { indexDrops, makeComplete, currentStreak, bestStreak, statusOf } = require('../lib/streak');
const { classify } = require('../lib/media');

function both(days) {
  return days.flatMap((day) => ['a', 'b'].map((userId) => ({ day, userId })));
}

test('les dates calendaires avancent sans fuseau', () => {
  assert.equal(addDays('2026-10-24', -1), '2026-10-23');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('la tâche du jour est stable', () => {
  const prompt = promptFor('2026-10-24');
  assert.equal(promptFor('2026-10-24').title, prompt.title);
  assert.ok(PROMPTS.length >= 8);
  assert.ok(prompt.hint);
});

test('la flamme compte les jours où les deux ont déposé', () => {
  const done = makeComplete(indexDrops(both(['2026-10-22', '2026-10-23', '2026-10-24'])), ['a', 'b']);
  assert.equal(currentStreak(done, '2026-10-24'), 3);
  assert.equal(bestStreak(done, '2026-10-22', '2026-10-24'), 3);
});

test('tant que la journée n’est pas finie, la série de la veille tient', () => {
  const done = makeComplete(indexDrops(both(['2026-10-22', '2026-10-23'])), ['a', 'b']);
  assert.equal(currentStreak(done, '2026-10-24'), 2);
  assert.equal(statusOf({
    memberCount: 2,
    youPosted: false,
    partnerPosted: false,
    count: 2,
    todayComplete: false,
    createdDay: '2026-10-22',
    today: '2026-10-24',
  }), 'open');
});

test('un jour manqué éteint la flamme et garde le record', () => {
  const done = makeComplete(indexDrops(both(['2026-10-20', '2026-10-21'])), ['a', 'b']);
  assert.equal(currentStreak(done, '2026-10-24'), 0);
  assert.equal(bestStreak(done, '2026-10-20', '2026-10-24'), 2);
  assert.equal(statusOf({
    memberCount: 2,
    youPosted: false,
    partnerPosted: false,
    count: 0,
    todayComplete: false,
    createdDay: '2026-10-20',
    today: '2026-10-24',
  }), 'cold');
});

test('deux photos après une coupure rallument à 1', () => {
  const done = makeComplete(indexDrops(both(['2026-10-20', '2026-10-21', '2026-10-24'])), ['a', 'b']);
  assert.equal(currentStreak(done, '2026-10-24'), 1);
  assert.equal(bestStreak(done, '2026-10-20', '2026-10-24'), 2);
  assert.equal(statusOf({
    memberCount: 2,
    youPosted: true,
    partnerPosted: true,
    count: 1,
    todayComplete: true,
    createdDay: '2026-10-20',
    today: '2026-10-24',
  }), 'lit');
});

test('seul, la flamme ne démarre pas', () => {
  const done = makeComplete(indexDrops([{ day: '2026-10-24', userId: 'a' }]), ['a']);
  assert.equal(done('2026-10-24'), false);
  assert.equal(currentStreak(done, '2026-10-24'), 0);
  assert.equal(statusOf({
    memberCount: 1,
    youPosted: true,
    partnerPosted: false,
    count: 0,
    todayComplete: false,
    createdDay: '2026-10-24',
    today: '2026-10-24',
  }), 'solo');
});

test('les états du jour', () => {
  const base = { memberCount: 2, count: 0, todayComplete: false, createdDay: '2026-10-24', today: '2026-10-24' };
  assert.equal(statusOf({ ...base, youPosted: false, partnerPosted: false }), 'new');
  assert.equal(statusOf({ ...base, youPosted: true, partnerPosted: false }), 'waiting_partner');
  assert.equal(statusOf({ ...base, youPosted: false, partnerPosted: true, count: 4, createdDay: '2026-10-01' }), 'waiting_you');
});

test('une photo est reconnue, un texte ne l’est pas', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(180, 4)]);
  const photo = classify(jpeg);
  assert.equal(photo.mime, 'image/jpeg');
  assert.equal(photo.ext, '.jpg');
  assert.equal(classify(Buffer.from('bonjour bonjour bonjour')), null);
  assert.equal(classify(Buffer.from([0xff, 0xd8, 0xff])).error, 'Image trop petite.');
});
