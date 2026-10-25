'use strict';

const { addDays } = require('./day');

function indexDrops(drops) {
  const byDay = {};
  for (const drop of drops) {
    if (!byDay[drop.day]) byDay[drop.day] = {};
    byDay[drop.day][drop.userId] = drop;
  }
  return byDay;
}

function makeComplete(byDay, memberIds) {
  return function isComplete(day) {
    if (!memberIds || memberIds.length < 2) return false;
    return memberIds.every((id) => Boolean(byDay[day]?.[id]));
  };
}

function currentStreak(isComplete, today) {
  let cursor = isComplete(today) ? today : addDays(today, -1);
  if (!isComplete(cursor)) return 0;
  let count = 0;
  while (isComplete(cursor) && count < 5000) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function bestStreak(isComplete, createdDay, today) {
  if (!createdDay || createdDay > today) return 0;
  let best = 0;
  let run = 0;
  let cursor = createdDay;
  for (let i = 0; i < 5000 && cursor <= today; i += 1) {
    if (isComplete(cursor)) {
      run += 1;
      if (run > best) best = run;
    } else if (cursor !== today) {
      run = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return best;
}

function statusOf({ memberCount, youPosted, partnerPosted, othersPosted, count, todayComplete, createdDay, today }) {
  if (memberCount < 2) return 'solo';
  if (todayComplete) return 'lit';
  const others = Math.max(0, memberCount - 1);
  const postedOthers = othersPosted == null ? (partnerPosted ? others : 0) : othersPosted;
  if (youPosted && postedOthers < others) return 'waiting_partner';
  if (!youPosted && postedOthers > 0) return 'waiting_you';
  if (count > 0) return 'open';
  if (createdDay === today) return 'new';
  return 'cold';
}

module.exports = { indexDrops, makeComplete, currentStreak, bestStreak, statusOf };
