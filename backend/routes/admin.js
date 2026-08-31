'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { signAdminToken, adminAuthMiddleware } = require('../middleware/adminAuth');
const { normalizeDateYmd } = require('../utils/storeTimezone');
const { listBlockedDates, addBlockedDate, removeBlockedDate } = require('../services/blockedDates');

function createAdminRouter(db) {
    const router = express.Router();
    const adminAuth = adminAuthMiddleware(db);

    function publicSiteUrl(req) {
        return (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    }

    function mapBookingRow(row) {
        if (!row) return null;
        return {
            id: row.id,
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            phone: row.phone,
            service_address: row.service_address,
            notary_cert_count: row.notary_cert_count,
            preferred_date: normalizeDateYmd(row.preferred_date),
            preferred_time: String(row.preferred_time).slice(0, 5),
            status: row.status,
            notes: row.notes,
            admin_notes: row.admin_notes,
            customer_request_type: row.customer_request_type || 'none',
            customer_request_notes: row.customer_request_notes,
            requested_date: row.requested_date,
            requested_time: row.requested_time ? String(row.requested_time).slice(0, 5) : null,
            customer_request_at: row.customer_request_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }

    async function getOrCreateCalendarToken(adminId) {
        const { newCalendarToken } = require('../db');
        const [rows] = await db.query(
            'SELECT token FROM admin_calendar_tokens WHERE admin_user_id = ? ORDER BY id DESC LIMIT 1',
            [adminId]
        );
        if (rows[0]?.token) return rows[0].token;

        const token = newCalendarToken();
        await db.execute('INSERT INTO admin_calendar_tokens (admin_user_id, token) VALUES (?, ?)', [adminId, token]);
        return token;
    }

    router.post('/auth/login', async (req, res) => {
        try {
            const email = String(req.body?.email || '').trim().toLowerCase();
            const password = String(req.body?.password || '');

            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const [rows] = await db.query(
                'SELECT id, email, password_hash, is_active FROM admin_users WHERE LOWER(email) = ? LIMIT 1',
                [email]
            );
            const admin = rows[0];
            if (!admin || !admin.is_active) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const ok = await bcrypt.compare(password, admin.password_hash);
            if (!ok) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            await db.execute('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);

            res.json({
                token: signAdminToken(admin),
                email: admin.email,
            });
        } catch (err) {
            console.error('admin login error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/auth/me', adminAuth, (req, res) => {
        res.json({ email: req.admin.email, id: req.admin.id });
    });

    router.post('/auth/forgot-password', async (_req, res) => {
        res.json({
            message: 'If an account with that email exists, a password reset link has been sent.',
        });
    });

    router.get('/calendar-feed', adminAuth, async (req, res) => {
        try {
            const token = await getOrCreateCalendarToken(req.admin.id);
            const feedUrl = `${publicSiteUrl(req)}/api/booking/calendar.ics?token=${encodeURIComponent(token)}`;
            res.json({ feedUrl, token });
        } catch (err) {
            console.error('calendar-feed error:', err);
            res.status(500).json({ error: 'Could not load calendar link' });
        }
    });

    router.post('/calendar-feed/rotate', adminAuth, async (req, res) => {
        try {
            await db.execute('DELETE FROM admin_calendar_tokens WHERE admin_user_id = ?', [req.admin.id]);
            const { newCalendarToken } = require('../db');
            const token = newCalendarToken();
            await db.execute('INSERT INTO admin_calendar_tokens (admin_user_id, token) VALUES (?, ?)', [
                req.admin.id,
                token,
            ]);
            const feedUrl = `${publicSiteUrl(req)}/api/booking/calendar.ics?token=${encodeURIComponent(token)}`;
            res.json({ feedUrl, token });
        } catch (err) {
            console.error('calendar-feed rotate error:', err);
            res.status(500).json({ error: 'Could not rotate calendar link' });
        }
    });

    router.get('/bookings', adminAuth, async (req, res) => {
        try {
            const { status, from, to, limit = 500 } = req.query;
            const conditions = [];
            const params = [];

            if (status) {
                conditions.push('status = ?');
                params.push(status);
            }
            if (from) {
                conditions.push('preferred_date >= ?');
                params.push(normalizeDateYmd(from) || from);
            }
            if (to) {
                conditions.push('preferred_date <= ?');
                params.push(normalizeDateYmd(to) || to);
            }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 1000);

            const [bookings] = await db.query(
                `SELECT * FROM notary_bookings ${where}
                 ORDER BY preferred_date ASC, preferred_time ASC
                 LIMIT ${limitNum}`,
                params
            );

            res.json({ bookings: bookings.map(mapBookingRow) });
        } catch (err) {
            console.error('admin bookings list error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.put('/bookings/:id', adminAuth, async (req, res) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isFinite(bookingId) || bookingId < 1) {
                return res.status(400).json({ error: 'Invalid booking id' });
            }

            const [rows] = await db.query('SELECT * FROM notary_bookings WHERE id = ? LIMIT 1', [bookingId]);
            const before = rows[0];
            if (!before) {
                return res.status(404).json({ error: 'Booking not found' });
            }

            const {
                status = before.status,
                preferred_date = before.preferred_date,
                preferred_time = before.preferred_time,
                admin_notes = before.admin_notes,
            } = req.body || {};

            const nextDate = normalizeDateYmd(preferred_date) || String(preferred_date).slice(0, 10);
            const nextTime = String(preferred_time).slice(0, 5);

            await db.execute(
                `UPDATE notary_bookings
                 SET status = ?, preferred_date = ?, preferred_time = ?, admin_notes = ?,
                     customer_request_type = 'none', customer_request_notes = NULL
                 WHERE id = ?`,
                [status, nextDate, `${nextTime}:00`, admin_notes, bookingId]
            );

            const [updated] = await db.query('SELECT * FROM notary_bookings WHERE id = ? LIMIT 1', [bookingId]);
            res.json({ booking: mapBookingRow(updated[0]) });
        } catch (err) {
            console.error('admin booking update error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/blocked-dates', adminAuth, async (req, res) => {
        try {
            const blockedDates = await listBlockedDates(db, req.query.from, req.query.to);
            res.json({ blockedDates });
        } catch (err) {
            console.error('admin blocked-dates list error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/blocked-dates', adminAuth, async (req, res) => {
        try {
            const created = await addBlockedDate(db, req.body?.date, req.body?.reason, req.admin.id);
            res.status(201).json({ message: 'Date blocked from online booking', ...created });
        } catch (err) {
            res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
        }
    });

    router.delete('/blocked-dates/:date', adminAuth, async (req, res) => {
        try {
            const removed = await removeBlockedDate(db, req.params.date);
            res.json({ message: 'Date unblocked', ...removed });
        } catch (err) {
            res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
        }
    });

    return router;
}

module.exports = createAdminRouter;
