'use strict';

const { STORE_TIMEZONE } = require('../utils/storeTimezone');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function escapeIcalText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding — required for Google Calendar. */
function foldLine(line) {
    const max = 75;
    if (line.length <= max) return line;
    let out = line.slice(0, max);
    let i = max;
    while (i < line.length) {
        out += `\r\n ${line.slice(i, i + max)}`;
        i += max;
    }
    return out;
}

function toIcalLocal(dateYmd, timeHm) {
    const date = String(dateYmd).slice(0, 10).replace(/-/g, '');
    const [hh, mm] = String(timeHm).slice(0, 5).split(':').map(Number);
    return `${date}T${pad2(hh)}${pad2(mm || 0)}00`;
}

function vtimezoneBlock(tz) {
    if (tz === 'America/Chicago') {
        return [
            'BEGIN:VTIMEZONE',
            'TZID:America/Chicago',
            'X-LIC-LOCATION:America/Chicago',
            'BEGIN:DAYLIGHT',
            'TZOFFSETFROM:-0600',
            'TZOFFSETTO:-0500',
            'TZNAME:CDT',
            'DTSTART:19700308T020000',
            'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
            'END:DAYLIGHT',
            'BEGIN:STANDARD',
            'TZOFFSETFROM:-0500',
            'TZOFFSETTO:-0600',
            'TZNAME:CST',
            'DTSTART:19701101T020000',
            'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
            'END:STANDARD',
            'END:VTIMEZONE',
        ].join('\r\n');
    }

    return ['BEGIN:VTIMEZONE', `TZID:${tz}`, 'END:VTIMEZONE'].join('\r\n');
}

function icalTimestamp(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) {
        return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function bookingToVevent(booking, tz, slotDurationMinutes = 60) {
    const date = String(booking.preferred_date).slice(0, 10);
    const time = String(booking.preferred_time).slice(0, 5);
    const [hh, mm] = time.split(':').map(Number);
    const endMinutes = hh * 60 + (mm || 0) + slotDurationMinutes;
    const endTime = `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;

    const name = `${booking.first_name || ''} ${booking.last_name || ''}`.trim();
    const summary = `Notary: ${name}`;
    const description = [
        `Client: ${name}`,
        `Phone: ${booking.phone || ''}`,
        `Email: ${booking.email || ''}`,
        `Address: ${booking.service_address || ''}`,
        `Stamps: ${booking.notary_cert_count || 1}`,
        booking.notes ? `Notes: ${booking.notes}` : '',
        `Status: ${booking.status}`,
    ]
        .filter(Boolean)
        .join('\n');

    const uid = `notary-booking-${booking.id}@docusealmobilenotary.net`;
    const dtstamp = icalTimestamp();
    const lastMod = icalTimestamp(booking.updated_at || booking.created_at);

    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `LAST-MODIFIED:${lastMod}`,
        `DTSTART;TZID=${tz}:${toIcalLocal(date, time)}`,
        `DTEND;TZID=${tz}:${toIcalLocal(date, endTime)}`,
        foldLine(`SUMMARY:${escapeIcalText(summary)}`),
        foldLine(`DESCRIPTION:${escapeIcalText(description)}`),
        foldLine(`LOCATION:${escapeIcalText(booking.service_address || '')}`),
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'TRANSP:OPAQUE',
        'END:VEVENT',
    ];

    return lines.join('\r\n');
}

function buildIcalFeed(bookings, tz = STORE_TIMEZONE) {
    const events = (bookings || [])
        .filter((b) => String(b.status).toLowerCase() !== 'cancelled')
        .map((b) => bookingToVevent(b, tz))
        .join('\r\n');

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//DocuSeal Mobile Notary//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:DocuSeal Mobile Notary',
        `X-WR-TIMEZONE:${tz}`,
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        vtimezoneBlock(tz),
        events,
        'END:VCALENDAR',
    ]
        .filter(Boolean)
        .join('\r\n') + '\r\n';
}

module.exports = {
    buildIcalFeed,
    bookingToVevent,
    toIcalLocal,
};
