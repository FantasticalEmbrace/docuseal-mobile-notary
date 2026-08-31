'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createDb } = require('./db');
const { STORE_TIMEZONE } = require('./utils/storeTimezone');
const bookingRoutes = require('./routes/booking');
const createAdminRouter = require('./routes/admin');
const { serveCalendarFeed } = require('./routes/calendarFeed');

const PORT = Number(process.env.PORT || 3020);
const STATIC_ROOT = path.join(__dirname, '..');

async function ensureDefaultAdmin(db) {
    const [rows] = await db.query('SELECT COUNT(*) AS c FROM admin_users');
    const count = Number(rows[0]?.c ?? rows[0]?.count ?? 0);
    if (count > 0) return;

    const email = (process.env.ADMIN_EMAIL || 'admin@localhost').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'changeme';
    const hash = await bcrypt.hash(password, 12);

    await db.execute(
        'INSERT INTO admin_users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)',
        [email, hash, 'Admin', 'User']
    );

    console.log(`Created default admin: ${email}`);
    if (!process.env.ADMIN_PASSWORD) {
        console.log('Default password: changeme — change ADMIN_PASSWORD in .env');
    }
}

async function start() {
    const db = createDb();
    await ensureDefaultAdmin(db);

    const app = express();

    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    app.use((req, _res, next) => {
        req.db = db;
        next();
    });

    app.use(express.json({ limit: '1mb' }));

    app.get('/api/health', (_req, res) => {
        res.json({ ok: true, timezone: STORE_TIMEZONE });
    });

    app.get('/api/booking/calendar.ics', serveCalendarFeed);

    app.use('/api/booking', (req, res, next) => {
        if (req.path === '/calendar.ics' || req.originalUrl.endsWith('/calendar.ics')) {
            return serveCalendarFeed(req, res);
        }
        next();
    });

    app.use('/api/booking', bookingRoutes);
    app.use('/api/admin', createAdminRouter(db));

    app.use(express.static(STATIC_ROOT, {
        index: ['index.html'],
        extensions: ['html'],
    }));

    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.listen(PORT, () => {
        console.log(`DocuSeal booking API listening on http://127.0.0.1:${PORT}`);
        console.log(`Admin: http://127.0.0.1:${PORT}/admin.html`);
    });
}

start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
