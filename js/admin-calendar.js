'use strict';

(function () {
    const STORE_OPEN_HOUR = 8;
    const STORE_CLOSE_HOUR = 19;
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const TOKEN_KEY = 'docuseal_admin_token';

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function ymdFromDate(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function parseBookingYmd(booking) {
        const raw = booking.preferred_date;
        if (!raw) return '';
        return String(raw).slice(0, 10);
    }

    function parseBookingTimeHm(booking) {
        const t = booking.preferred_time;
        if (!t) return '08:00';
        return String(t).slice(0, 5);
    }

    function formatTimeDisplay(hm) {
        const [h, m] = String(hm).slice(0, 5).split(':').map(Number);
        if (!Number.isFinite(h)) return hm;
        const d = new Date();
        d.setHours(h, m || 0, 0, 0);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    function startOfWeek(d) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        x.setDate(x.getDate() - x.getDay());
        return x;
    }

    function addDays(d, n) {
        const x = new Date(d);
        x.setDate(x.getDate() + n);
        return x;
    }

    function addMonths(d, n) {
        const x = new Date(d);
        x.setMonth(x.getMonth() + n);
        return x;
    }

    function sameYmd(a, b) {
        return ymdFromDate(a) === ymdFromDate(b);
    }

    function statusClass(status) {
        const s = String(status || '').toLowerCase();
        if (s === 'cancelled') return 'notary-ev-cancelled';
        if (s === 'pending') return 'notary-ev-pending';
        return 'notary-ev-confirmed';
    }

    function calendarRange(cursor, view) {
        if (view === 'day') {
            const y = ymdFromDate(cursor);
            return { from: y, to: y };
        }
        if (view === 'week') {
            const start = startOfWeek(cursor);
            const end = addDays(start, 6);
            return { from: ymdFromDate(start), to: ymdFromDate(end) };
        }
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const gridStart = startOfWeek(first);
        const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const gridEnd = addDays(startOfWeek(last), 6);
        return { from: ymdFromDate(gridStart), to: ymdFromDate(gridEnd) };
    }

    function periodTitle(cursor, view) {
        if (view === 'day') {
            return cursor.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
        }
        if (view === 'week') {
            const start = startOfWeek(cursor);
            const end = addDays(start, 6);
            const opts = { month: 'short', day: 'numeric' };
            const y =
                start.getFullYear() === end.getFullYear()
                    ? start.getFullYear()
                    : `${start.getFullYear()}–${end.getFullYear()}`;
            return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}, ${y}`;
        }
        return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    function bookingsForYmd(bookings, ymd) {
        return bookings
            .filter((b) => parseBookingYmd(b) === ymd)
            .sort((a, b) => parseBookingTimeHm(a).localeCompare(parseBookingTimeHm(b)));
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    class AdminCalendarApp {
        constructor() {
            this.apiOrigin = window.DOCUSEAL_API_ORIGIN || window.location.origin;
            this._view = 'month';
            this._cursor = new Date();
            this._bookings = [];
            this._bookingsById = new Map();
            this._blockedDates = new Set();
            this._blockedDatesList = [];
            this._blockMode = false;
        }

        getToken() {
            return localStorage.getItem(TOKEN_KEY) || '';
        }

        authHeaders() {
            return {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + this.getToken(),
            };
        }

        async apiRequest(path, options = {}) {
            const res = await fetch(`${this.apiOrigin}/api/admin${path}`, {
                ...options,
                headers: { ...this.authHeaders(), ...(options.headers || {}) },
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 401) {
                localStorage.removeItem(TOKEN_KEY);
                window.location.reload();
                throw new Error('Unauthorized');
            }
            if (!res.ok) {
                throw new Error(data.error || 'Request failed');
            }
            return data;
        }

        showToast(message, type = 'info') {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            const el = document.createElement('div');
            el.className = 'toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
            el.textContent = message;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 3500);
        }

        getRange() {
            return calendarRange(this._cursor, this._view);
        }

        renderEventChip(booking, compact) {
            const name = `${booking.first_name || ''} ${booking.last_name || ''}`.trim() || 'Guest';
            const time = formatTimeDisplay(parseBookingTimeHm(booking));
            const req = booking.customer_request_type && booking.customer_request_type !== 'none';
            const label = compact ? `${time} ${name.split(' ')[0]}` : `${time} — ${name}`;
            return `<button type="button" class="notary-cal-event ${statusClass(booking.status)}${req ? ' notary-ev-request' : ''}" data-booking-id="${booking.id}" title="${escapeHtml(name)} · ${escapeHtml(booking.email || '')}">${escapeHtml(label)}</button>`;
        }

        renderShell() {
            const title = periodTitle(this._cursor, this._view);
            const errorBanner = this._loadError
                ? `<div class="status-box error" style="margin-bottom:1rem;">${escapeHtml(this._loadError)}</div>`
                : '';
            return `
                ${errorBanner}
                <p class="admin-intro">
                    Calendar view — click an appointment to edit. Use <strong>Block dates</strong> to close days to online booking.
                    Bookings only appear here when the site uses the booking modal (not Calendly) and the backend API is running.
                </p>
                <div class="notary-cal" id="notary-cal-root">
                    <div class="notary-cal-toolbar">
                        <div class="notary-cal-nav">
                            <button type="button" class="btn-sm secondary" id="notary-cal-today">Today</button>
                            <button type="button" class="btn-sm secondary" id="notary-cal-prev" aria-label="Previous">&lsaquo;</button>
                            <button type="button" class="btn-sm secondary" id="notary-cal-next" aria-label="Next">&rsaquo;</button>
                            <h2 class="notary-cal-title" id="notary-cal-title">${escapeHtml(title)}</h2>
                        </div>
                        <div class="notary-cal-views" role="tablist">
                            <button type="button" class="btn-sm ${this._view === 'day' ? 'primary' : 'secondary'}" data-notary-view="day">Day</button>
                            <button type="button" class="btn-sm ${this._view === 'week' ? 'primary' : 'secondary'}" data-notary-view="week">Week</button>
                            <button type="button" class="btn-sm ${this._view === 'month' ? 'primary' : 'secondary'}" data-notary-view="month">Month</button>
                        </div>
                        <button type="button" class="btn-sm ${this._blockMode ? 'primary' : 'secondary'}" id="notary-cal-block-mode">
                            ${this._blockMode ? 'Block mode on' : 'Block dates'}
                        </button>
                    </div>
                    <div class="notary-cal-legend">
                        <span><i class="notary-legend-dot notary-ev-confirmed"></i> Confirmed</span>
                        <span><i class="notary-legend-dot notary-ev-pending"></i> Pending</span>
                        <span><i class="notary-legend-dot notary-ev-cancelled"></i> Cancelled</span>
                        <span><i class="notary-legend-dot notary-ev-request"></i> Customer request</span>
                        <span><i class="notary-legend-dot notary-ev-blocked"></i> Blocked day</span>
                    </div>
                    <div id="notary-blocked-dates-panel" class="notary-blocked-panel"></div>
                    <div id="notary-cal-body" class="notary-cal-body"></div>
                    <details class="notary-cal-table-toggle" open>
                        <summary>All bookings (table)</summary>
                        <div id="notary-cal-table-wrap"></div>
                    </details>
                </div>`;
        }

        renderMonthView(bookings, cursor) {
            const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const gridStart = startOfWeek(first);
            const today = new Date();
            let html = '<div class="notary-month-grid">';
            html += WEEKDAYS.map((d) => `<div class="notary-month-dow">${d}</div>`).join('');

            for (let i = 0; i < 42; i++) {
                const day = addDays(gridStart, i);
                const ymd = ymdFromDate(day);
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameYmd(day, today);
                const dayBookings = bookingsForYmd(bookings, ymd);
                const isBlocked = this._blockedDates.has(ymd);
                const classes = [
                    'notary-month-cell',
                    inMonth ? '' : 'notary-month-other',
                    isToday ? 'notary-month-today' : '',
                    isBlocked ? 'notary-month-blocked' : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                const events = dayBookings.slice(0, 3).map((b) => this.renderEventChip(b, true)).join('');
                const more =
                    dayBookings.length > 3
                        ? `<span class="notary-month-more">+${dayBookings.length - 3} more</span>`
                        : '';

                html += `<div class="${classes}" data-notary-day="${ymd}"${isBlocked ? ' title="Blocked from online booking"' : ''}>
                    <div class="notary-month-num">${day.getDate()}${isBlocked ? ' ×' : ''}</div>
                    <div class="notary-month-events">${events}${more}</div>
                </div>`;
            }
            html += '</div>';
            return html;
        }

        renderWeekView(bookings, cursor) {
            const start = startOfWeek(cursor);
            const today = new Date();
            let html = '<div class="notary-week-wrap"><div class="notary-week-cols">';

            for (let d = 0; d < 7; d++) {
                const day = addDays(start, d);
                const ymd = ymdFromDate(day);
                const isToday = sameYmd(day, today);
                html += `<div class="notary-week-col${isToday ? ' notary-week-today' : ''}">
                    <div class="notary-week-head">
                        <span class="notary-week-dow">${WEEKDAYS[day.getDay()]}</span>
                        <span class="notary-week-date">${day.getDate()}</span>
                    </div>`;

                for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                    const hm = `${pad2(hour)}:00`;
                    const slotBookings = bookingsForYmd(bookings, ymd).filter(
                        (b) => parseBookingTimeHm(b) === hm
                    );
                    html += `<div class="notary-week-slot">
                        <span class="notary-week-slot-time">${formatTimeDisplay(hm)}</span>
                        <div class="notary-week-slot-events">`;
                    slotBookings.forEach((b) => {
                        html += this.renderEventChip(b, false);
                    });
                    html += '</div></div>';
                }
                html += '</div>';
            }
            html += '</div></div>';
            return html;
        }

        renderDayView(bookings, cursor) {
            const ymd = ymdFromDate(cursor);
            const dayBookings = bookingsForYmd(bookings, ymd);
            let html = '<div class="notary-day-view">';
            if (dayBookings.length === 0) {
                html += '<p class="notary-day-empty">No appointments scheduled for this day.</p>';
            } else {
                for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                    const hm = `${pad2(hour)}:00`;
                    const slotBookings = dayBookings.filter((b) => parseBookingTimeHm(b) === hm);
                    html += `<div class="notary-day-row">
                        <div class="notary-day-time">${formatTimeDisplay(hm)}</div>
                        <div class="notary-day-events">`;
                    if (slotBookings.length === 0) {
                        html += '—';
                    } else {
                        slotBookings.forEach((b) => {
                            html += this.renderEventChip(b, false);
                        });
                    }
                    html += '</div></div>';
                }
            }
            html += '</div>';
            return html;
        }

        renderBookingsTable(bookings) {
            if (!bookings.length) {
                return '<p class="notary-day-empty">No bookings in this range.</p>';
            }
            return `
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Phone</th>
                                <th>Date</th>
                                <th>Time</th>
                                <th>Address</th>
                                <th>Stamps</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${bookings
                                .map(
                                    (b) => `
                                <tr>
                                    <td>${escapeHtml(`${b.first_name || ''} ${b.last_name || ''}`.trim())}</td>
                                    <td>${escapeHtml(b.email)}</td>
                                    <td>${escapeHtml(b.phone || '')}</td>
                                    <td>${escapeHtml(parseBookingYmd(b))}</td>
                                    <td>${escapeHtml(parseBookingTimeHm(b))}</td>
                                    <td>${escapeHtml(b.service_address || '')}</td>
                                    <td>${escapeHtml(b.notary_cert_count ?? '')}</td>
                                    <td><span class="badge badge-${b.status === 'confirmed' ? 'success' : b.status === 'pending' ? 'warning' : b.status === 'cancelled' ? 'danger' : 'info'}">${escapeHtml(String(b.status || '').toUpperCase())}</span></td>
                                    <td><button type="button" class="btn-sm secondary" data-edit-booking="${b.id}">Edit</button></td>
                                </tr>`
                                )
                                .join('')}
                        </tbody>
                    </table>
                </div>`;
        }

        renderBody() {
            const body = document.getElementById('notary-cal-body');
            const titleEl = document.getElementById('notary-cal-title');
            if (!body) return;

            if (titleEl) titleEl.textContent = periodTitle(this._cursor, this._view);

            if (this._view === 'month') {
                body.innerHTML = this.renderMonthView(this._bookings, this._cursor);
            } else if (this._view === 'week') {
                body.innerHTML = this.renderWeekView(this._bookings, this._cursor);
            } else {
                body.innerHTML = this.renderDayView(this._bookings, this._cursor);
            }

            body.querySelectorAll('[data-booking-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = Number(btn.getAttribute('data-booking-id'));
                    if (Number.isFinite(id)) this.openBookingModal(id);
                });
            });

            const tableWrap = document.getElementById('notary-cal-table-wrap');
            if (tableWrap) {
                tableWrap.innerHTML = this.renderBookingsTable(this._bookings);
                tableWrap.querySelectorAll('[data-edit-booking]').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const id = Number(btn.getAttribute('data-edit-booking'));
                        if (Number.isFinite(id)) this.openBookingModal(id);
                    });
                });
            }

            document.querySelectorAll('[data-notary-view]').forEach((btn) => {
                const v = btn.getAttribute('data-notary-view');
                btn.className = `btn-sm ${v === this._view ? 'primary' : 'secondary'}`;
            });
        }

        renderBlockedPanel() {
            const panel = document.getElementById('notary-blocked-dates-panel');
            if (!panel) return;
            const blocked = this._blockedDatesList || [];
            if (!blocked.length) {
                panel.innerHTML = this._blockMode
                    ? '<p class="notary-blocked-hint">Block mode is on — click a day on the calendar to block or unblock it.</p>'
                    : '';
                return;
            }
            const chips = blocked
                .map((b) => {
                    const date = String(b.date || b.block_date || '').slice(0, 10);
                    return `<button type="button" class="btn-sm secondary notary-blocked-chip" data-unblock-date="${escapeHtml(date)}">${escapeHtml(date)} ×</button>`;
                })
                .join('');
            panel.innerHTML = `<div class="notary-blocked-wrap"><strong>Blocked dates:</strong> ${chips}</div>`;
            panel.querySelectorAll('[data-unblock-date]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    void this.toggleBlockedDate(btn.getAttribute('data-unblock-date'), true);
                });
            });
        }

        bindControls() {
            const root = document.getElementById('notary-cal-root');
            if (!root || root.dataset.bound === '1') return;
            root.dataset.bound = '1';

            document.getElementById('notary-cal-today')?.addEventListener('click', () => {
                this._cursor = new Date();
                void this.refresh();
            });

            document.getElementById('notary-cal-prev')?.addEventListener('click', () => {
                this.stepCalendar(-1);
            });

            document.getElementById('notary-cal-next')?.addEventListener('click', () => {
                this.stepCalendar(1);
            });

            root.querySelectorAll('[data-notary-view]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._view = btn.getAttribute('data-notary-view') || 'month';
                    void this.refresh();
                });
            });

            root.querySelector('#notary-cal-body')?.addEventListener('click', (e) => {
                const cell = e.target.closest('[data-notary-day]');
                if (!cell || e.target.closest('[data-booking-id]')) return;
                const ymd = cell.getAttribute('data-notary-day');
                if (!ymd) return;

                if (this._blockMode) {
                    void this.toggleBlockedDate(ymd);
                    return;
                }

                const [y, m, d] = ymd.split('-').map(Number);
                this._cursor = new Date(y, m - 1, d);
                this._view = 'day';
                this.renderBody();
            });

            document.getElementById('notary-cal-block-mode')?.addEventListener('click', () => {
                this._blockMode = !this._blockMode;
                const btn = document.getElementById('notary-cal-block-mode');
                if (btn) {
                    btn.textContent = this._blockMode ? 'Block mode on' : 'Block dates';
                    btn.className = `btn-sm ${this._blockMode ? 'primary' : 'secondary'}`;
                }
                this.renderBlockedPanel();
            });
        }

        stepCalendar(direction) {
            const c = this._cursor;
            if (this._view === 'month') {
                this._cursor = addMonths(c, direction);
            } else if (this._view === 'week') {
                this._cursor = addDays(c, direction * 7);
            } else {
                this._cursor = addDays(c, direction);
            }
            void this.refresh();
        }

        async toggleBlockedDate(ymd, forceUnblock = false) {
            const date = String(ymd || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
            const isBlocked = this._blockedDates.has(date);
            try {
                if (isBlocked || forceUnblock) {
                    await this.apiRequest(`/blocked-dates/${encodeURIComponent(date)}`, { method: 'DELETE' });
                    this.showToast(`${date} unblocked`, 'success');
                } else {
                    await this.apiRequest('/blocked-dates', {
                        method: 'POST',
                        body: JSON.stringify({ date }),
                    });
                    this.showToast(`${date} blocked from online booking`, 'success');
                }
            } catch (e) {
                this.showToast(e.message || 'Could not update blocked date', 'error');
                return;
            }
            await this.refresh();
        }

        buildTimeOptions(selected) {
            const sel = String(selected || '').slice(0, 5);
            let html = '';
            for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                const t = `${pad2(hour)}:00`;
                html += `<option value="${t}"${t === sel ? ' selected' : ''}>${formatTimeDisplay(t)}</option>`;
            }
            return html;
        }

        openBookingModal(bookingId) {
            const booking = this._bookingsById.get(Number(bookingId));
            if (!booking) {
                this.showToast('Booking not found. Refresh and try again.', 'error');
                return;
            }

            const dateVal = parseBookingYmd(booking);
            const timeVal = parseBookingTimeHm(booking);
            const name = `${booking.first_name || ''} ${booking.last_name || ''}`.trim();

            const overlay = document.createElement('div');
            overlay.className = 'booking-modal-overlay';
            overlay.innerHTML = `
                <div class="booking-modal" role="dialog" aria-labelledby="booking-edit-title">
                    <div class="booking-modal-header">
                        <h2 id="booking-edit-title">Booking #${booking.id}</h2>
                        <button type="button" class="btn-sm secondary" id="booking-edit-close" aria-label="Close">&times;</button>
                    </div>
                    <div class="booking-modal-body">
                        <p>${escapeHtml(name)} · ${escapeHtml(booking.email)}</p>
                        <p><strong>Address:</strong> ${escapeHtml(booking.service_address || '')}</p>
                        <p><strong>Stamps:</strong> ${escapeHtml(booking.notary_cert_count ?? '')}</p>
                        ${booking.notes ? `<p><strong>Customer notes:</strong> ${escapeHtml(booking.notes)}</p>` : ''}
                        <div class="form-group">
                            <label for="booking-edit-status">Status</label>
                            <select id="booking-edit-status">
                                <option value="pending"${booking.status === 'pending' ? ' selected' : ''}>Pending</option>
                                <option value="confirmed"${booking.status === 'confirmed' ? ' selected' : ''}>Confirmed</option>
                                <option value="cancelled"${booking.status === 'cancelled' ? ' selected' : ''}>Cancelled</option>
                                <option value="completed"${booking.status === 'completed' ? ' selected' : ''}>Completed</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="booking-edit-date">Appointment date</label>
                            <input type="date" id="booking-edit-date" value="${escapeHtml(dateVal)}">
                        </div>
                        <div class="form-group">
                            <label for="booking-edit-time">Appointment time</label>
                            <select id="booking-edit-time">${this.buildTimeOptions(timeVal)}</select>
                        </div>
                        <div class="form-group">
                            <label for="booking-edit-notes">Staff notes (internal)</label>
                            <textarea id="booking-edit-notes" rows="2">${escapeHtml(booking.admin_notes || '')}</textarea>
                        </div>
                    </div>
                    <div class="booking-modal-footer">
                        <button type="button" class="btn-sm secondary" id="booking-edit-cancel">Close</button>
                        <button type="button" class="btn-sm primary" id="booking-edit-save">Save changes</button>
                    </div>
                </div>`;

            const close = () => overlay.remove();
            overlay.querySelector('#booking-edit-close')?.addEventListener('click', close);
            overlay.querySelector('#booking-edit-cancel')?.addEventListener('click', close);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });

            overlay.querySelector('#booking-edit-save')?.addEventListener('click', async () => {
                const btn = overlay.querySelector('#booking-edit-save');
                btn.disabled = true;
                btn.textContent = 'Saving...';
                try {
                    await this.apiRequest(`/bookings/${booking.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            status: overlay.querySelector('#booking-edit-status').value,
                            preferred_date: overlay.querySelector('#booking-edit-date').value,
                            preferred_time: overlay.querySelector('#booking-edit-time').value,
                            admin_notes: overlay.querySelector('#booking-edit-notes').value,
                        }),
                    });
                    this.showToast('Booking updated', 'success');
                    close();
                    await this.refresh();
                } catch (e) {
                    this.showToast(e.message || 'Could not save booking', 'error');
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Save changes';
                }
            });

            document.body.appendChild(overlay);
        }

        async refresh() {
            const range = this.getRange();
            this._loadError = '';
            try {
                const [bookingsRes, blockedRes] = await Promise.all([
                    this.apiRequest(
                        `/bookings?limit=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
                    ),
                    this.apiRequest(
                        `/blocked-dates?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
                    ),
                ]);
                this._bookings = bookingsRes.bookings || [];
                this._bookingsById = new Map(this._bookings.map((b) => [Number(b.id), b]));
                const blocked = blockedRes.blockedDates || [];
                this._blockedDates = new Set(blocked.map((b) => String(b.date || b.block_date || '').slice(0, 10)));
                this._blockedDatesList = blocked;
            } catch (e) {
                console.warn('Calendar refresh:', e);
                this._bookings = [];
                this._bookingsById = new Map();
                this._loadError =
                    'Could not load bookings from the API. Start the backend (cd backend && npm start) and open admin through http://localhost:3020/admin.html — not as a file on your desktop.';
                if (String(e.message || '').includes('Not found') || String(e.message || '').includes('404')) {
                    this._loadError +=
                        ' The server may be missing /api/admin/bookings — upload and run the backend folder from this repo.';
                }
            }
            const mount = document.getElementById('calendar-mount');
            if (mount && this._loadError) {
                const existing = mount.querySelector('.status-box.error');
                if (!existing) {
                    mount.insertAdjacentHTML('afterbegin', `<div class="status-box error" style="margin-bottom:1rem;">${escapeHtml(this._loadError)}</div>`);
                }
            }
            this.renderBody();
            this.renderBlockedPanel();
        }

        async mount(container) {
            container.innerHTML = this.renderShell();
            this.bindControls();
            await this.refresh();
        }
    }

    window.DocuSealAdminCalendar = AdminCalendarApp;
})();
