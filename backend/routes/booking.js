'use strict';

const express = require('express');
const { STORE_TIMEZONE, normalizeDateYmd, getStoreTodayYmd, isStoreDateTimeInFuture } = require('../utils/storeTimezone');
const { blockedDateSet } = require('../services/blockedDates');

const router = express.Router();

const WEEKLY_HOURS = {
    sunday: { open: '08:00', close: '19:00', closed: false },
    monday: { open: '08:00', close: '19:00', closed: false },
    tuesday: { open: '08:00', close: '19:00', closed: false },
    wednesday: { open: '08:00', close: '19:00', closed: false },
    thursday: { open: '08:00', close: '19:00', closed: false },
    friday: { open: '08:00', close: '15:00', closed: false },
    saturday: { open: '00:00', close: '00:00', closed: true },
    slotDuration: 60,
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getHoursForDate(dateYmd) {
    const [y, m, d] = String(dateYmd).slice(0, 10).split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return WEEKLY_HOURS[DAY_KEYS[dow]] || { closed: true };
}

function generateSlots(dateYmd) {
    const hours = getHoursForDate(dateYmd);
    if (hours.closed) return [];

    const [startHour, startMin] = hours.open.split(':').map(Number);
    const [endHour, endMin] = hours.close.split(':').map(Number);
    const duration = WEEKLY_HOURS.slotDuration;
    const slots = [];
    let hour = startHour;
    let minute = startMin;
    const endTotal = endHour * 60 + endMin;

    while (hour * 60 + minute + duration <= endTotal) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        slots.push(timeStr);
        minute += duration;
        if (minute >= 60) {
            hour += Math.floor(minute / 60);
            minute %= 60;
        }
    }
    return slots;
}

async function getBookedTimes(db, dateYmd, excludeId = null) {
    const params = [dateYmd];
    let excludeSql = '';
    if (excludeId) {
        excludeSql = ' AND id <> ?';
        params.push(excludeId);
    }
    const [rows] = await db.query(
        `SELECT preferred_time FROM notary_bookings
         WHERE preferred_date = ? AND status IN ('pending', 'confirmed')${excludeSql}`,
        params
    );
    return new Set(rows.map((r) => String(r.preferred_time).slice(0, 5)));
}

function mapBookingRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone: row.phone,
        serviceAddress: row.service_address,
        service_address: row.service_address,
        notaryCertCount: row.notary_cert_count,
        notary_cert_count: row.notary_cert_count,
        preferredDate: normalizeDateYmd(row.preferred_date),
        preferred_date: normalizeDateYmd(row.preferred_date),
        preferredTime: String(row.preferred_time).slice(0, 5),
        preferred_time: String(row.preferred_time).slice(0, 5),
        status: row.status,
        notes: row.notes,
        admin_notes: row.admin_notes,
        customer_request_type: row.customer_request_type,
        customer_request_notes: row.customer_request_notes,
        requested_date: row.requested_date,
        requested_time: row.requested_time,
        customer_request_at: row.customer_request_at,
        created_at: row.created_at,
    };
}

router.get('/hours', (_req, res) => {
    res.json({ hours: WEEKLY_HOURS });
});

router.get('/booking-context', async (req, res) => {
    try {
        const from = normalizeDateYmd(req.query.from);
        const to = normalizeDateYmd(req.query.to);
        const blocked = await blockedDateSet(req.db, from, to);
        res.json({
            storeTimezone: STORE_TIMEZONE,
            todayYmd: getStoreTodayYmd(),
            blockedDates: [...blocked],
            paymentRequired: false,
        });
    } catch (err) {
        console.error('booking-context error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/available-slots', async (req, res) => {
    try {
        const dateYmd = normalizeDateYmd(req.query.date);
        if (!dateYmd) {
            return res.status(400).json({ error: 'Invalid date' });
        }

        const blocked = await blockedDateSet(req.db, dateYmd, dateYmd);
        if (blocked.has(dateYmd)) {
            return res.json({ slots: [] });
        }

        const hours = getHoursForDate(dateYmd);
        if (hours.closed) {
            return res.json({ slots: [] });
        }

        const booked = await getBookedTimes(req.db, dateYmd);
        const slots = generateSlots(dateYmd).map((time) => ({
            time,
            available: !booked.has(time) && isStoreDateTimeInFuture(dateYmd, time),
        }));

        res.json({ slots });
    } catch (err) {
        console.error('available-slots error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/book', async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            serviceAddress,
            notaryCertCount,
            notes,
            preferredDate,
            preferredTime,
        } = req.body || {};

        if (!firstName || !lastName || !email || !phone || !preferredDate || !preferredTime) {
            return res.status(400).json({
                error: 'All required fields must be provided (firstName, lastName, email, phone, preferredDate, preferredTime)',
            });
        }

        if (!serviceAddress) {
            return res.status(400).json({ error: 'Service address is required' });
        }

        const dateYmd = normalizeDateYmd(preferredDate);
        const timeHm = String(preferredTime).slice(0, 5);
        if (!dateYmd || !/^\d{2}:\d{2}$/.test(timeHm)) {
            return res.status(400).json({ error: 'Invalid date or time' });
        }

        const certCount = Number.parseInt(notaryCertCount, 10);
        if (!Number.isFinite(certCount) || certCount < 1 || certCount > 99) {
            return res.status(400).json({ error: 'Invalid notary stamp count' });
        }

        const blocked = await blockedDateSet(req.db, dateYmd, dateYmd);
        if (blocked.has(dateYmd)) {
            return res.status(409).json({ error: 'That date is not available for booking' });
        }

        const hours = getHoursForDate(dateYmd);
        if (hours.closed) {
            return res.status(409).json({ error: 'That day is closed' });
        }

        if (!isStoreDateTimeInFuture(dateYmd, timeHm)) {
            return res.status(409).json({ error: 'That time slot is no longer available' });
        }

        const validSlots = new Set(generateSlots(dateYmd));
        if (!validSlots.has(timeHm)) {
            return res.status(409).json({ error: 'Invalid time slot' });
        }

        const booked = await getBookedTimes(req.db, dateYmd);
        if (booked.has(timeHm)) {
            return res.status(409).json({ error: 'That time slot is already booked' });
        }

        const [result] = await req.db.execute(
            `INSERT INTO notary_bookings (
                first_name, last_name, email, phone, service_address, notary_cert_count,
                preferred_date, preferred_time, notes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                String(firstName).trim().slice(0, 100),
                String(lastName).trim().slice(0, 100),
                String(email).trim().slice(0, 255),
                String(phone).trim().slice(0, 20),
                String(serviceAddress).trim().slice(0, 500),
                certCount,
                dateYmd,
                `${timeHm}:00`,
                notes ? String(notes).trim().slice(0, 2000) : null,
            ]
        );

        res.status(201).json({
            bookingId: result.insertId,
            preferredDate: dateYmd,
            preferredTime: timeHm,
            status: 'pending',
        });
    } catch (err) {
        console.error('book error:', err);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

router.get('/bookings/:id/confirmation-summary', async (req, res) => {
    try {
        const bookingId = Number(req.params.id);
        const email = String(req.query.email || '').trim().toLowerCase();
        if (!Number.isFinite(bookingId) || !email) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        const [rows] = await req.db.query(
            'SELECT * FROM notary_bookings WHERE id = ? AND LOWER(email) = ? LIMIT 1',
            [bookingId, email]
        );
        const booking = mapBookingRow(rows[0]);
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json(booking);
    } catch (err) {
        console.error('confirmation-summary error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
