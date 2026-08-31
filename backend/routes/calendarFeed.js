'use strict';

const { STORE_TIMEZONE, getStoreTodayYmd } = require('../utils/storeTimezone');
const { buildIcalFeed } = require('../services/ical');

function bookingsSinceYmd() {
    const today = getStoreTodayYmd();
    const [y, m, d] = today.split('-').map(Number);
    const past = new Date(y, m - 1, d);
    past.setDate(past.getDate() - 30);
    const py = past.getFullYear();
    const pm = String(past.getMonth() + 1).padStart(2, '0');
    const pd = String(past.getDate()).padStart(2, '0');
    return `${py}-${pm}-${pd}`;
}

async function serveCalendarFeed(req, res) {
    try {
        const token = String(req.query.token || '').trim();
        if (!token) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(401).send('Unauthorized');
        }

        const [tokenRows] = await req.db.query(
            'SELECT admin_user_id FROM admin_calendar_tokens WHERE token = ? LIMIT 1',
            [token]
        );
        if (!tokenRows[0]) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(401).send('Unauthorized');
        }

        const since = bookingsSinceYmd();
        const [bookings] = await req.db.query(
            `SELECT * FROM notary_bookings
             WHERE status IN ('pending', 'confirmed', 'completed')
               AND preferred_date >= ?
             ORDER BY preferred_date ASC, preferred_time ASC`,
            [since]
        );

        const ical = buildIcalFeed(bookings, STORE_TIMEZONE);

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="docuseal-notary.ics"');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.status(200).send(ical);
    } catch (err) {
        console.error('calendar.ics error:', err);
        res.status(500).send('Internal server error');
    }
}

module.exports = {
    serveCalendarFeed,
};
