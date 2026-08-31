'use strict';

const fs = require('fs');
const path = require('path');

const STORE_TIMEZONE = process.env.STORE_TIMEZONE || 'America/Chicago';

function normalizeDateYmd(value) {
    if (!value) return null;
    const raw = String(value).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function getStoreTodayYmd() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: STORE_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    return parts;
}

function isStoreDateTimeInFuture(dateYmd, timeHm) {
    const today = getStoreTodayYmd();
    const date = normalizeDateYmd(dateYmd);
    const time = String(timeHm || '').slice(0, 5);
    if (!date || !time) return false;
    if (date > today) return true;
    if (date < today) return false;

    const nowParts = new Intl.DateTimeFormat('en-US', {
        timeZone: STORE_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date());
    const partMap = Object.fromEntries(nowParts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    const nowHm = `${String(partMap.hour).padStart(2, '0')}:${String(partMap.minute).padStart(2, '0')}`;
    return time > nowHm;
}

module.exports = {
    STORE_TIMEZONE,
    normalizeDateYmd,
    getStoreTodayYmd,
    isStoreDateTimeInFuture,
};
