'use strict';

const { normalizeDateYmd } = require('../utils/storeTimezone');

async function listBlockedDates(db, fromYmd = null, toYmd = null) {
    const conditions = [];
    const params = [];
    const from = normalizeDateYmd(fromYmd);
    const to = normalizeDateYmd(toYmd);

    if (from) {
        conditions.push('block_date >= ?');
        params.push(from);
    }
    if (to) {
        conditions.push('block_date <= ?');
        params.push(to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await db.query(
        `SELECT id, block_date, reason, created_at FROM blocked_dates ${where} ORDER BY block_date ASC`,
        params
    );

    return rows.map((row) => ({
        id: row.id,
        date: normalizeDateYmd(row.block_date) || String(row.block_date).slice(0, 10),
        block_date: normalizeDateYmd(row.block_date) || String(row.block_date).slice(0, 10),
        reason: row.reason || null,
        createdAt: row.created_at,
    }));
}

async function blockedDateSet(db, fromYmd = null, toYmd = null) {
    const rows = await listBlockedDates(db, fromYmd, toYmd);
    return new Set(rows.map((r) => r.date));
}

async function addBlockedDate(db, dateYmd, reason = null, adminId = null) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd) {
        const err = new Error('Invalid date');
        err.status = 400;
        throw err;
    }

    try {
        await db.execute(
            'INSERT INTO blocked_dates (block_date, reason, created_by_admin_id) VALUES (?, ?, ?)',
            [ymd, reason ? String(reason).trim().slice(0, 500) : null, adminId || null]
        );
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT' || e.code === 'ER_DUP_ENTRY') {
            const err = new Error('That date is already blocked');
            err.status = 409;
            throw err;
        }
        throw e;
    }

    return { date: ymd, reason: reason || null };
}

async function removeBlockedDate(db, dateYmd) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd) {
        const err = new Error('Invalid date');
        err.status = 400;
        throw err;
    }

    const [result] = await db.execute('DELETE FROM blocked_dates WHERE block_date = ?', [ymd]);
    const affected = result.affectedRows ?? result.changes ?? 0;
    if (!affected) {
        const err = new Error('Blocked date not found');
        err.status = 404;
        throw err;
    }
    return { date: ymd };
}

module.exports = {
    listBlockedDates,
    blockedDateSet,
    addBlockedDate,
    removeBlockedDate,
};
