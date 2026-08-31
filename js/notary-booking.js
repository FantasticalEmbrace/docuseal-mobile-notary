'use strict';

class NotaryBookingSystem {
    constructor() {
        this.apiBaseUrl = this.getApiBaseUrl();
        this.availableSlots = [];
        this.selectedDate = null;
        this.selectedTime = null;
        this._listenersBound = false;
        this._displayYear = null;
        this._displayMonth = null;
        this.blockedDates = new Set();
        this.storeTodayYmd = null;
        this.storeTimezone = 'America/Chicago';
        this._step = 'schedule';
        this._redirecting = false;
        this.weeklyHours = null;
        this.slotDuration = 60;
        this.init();
    }

    apiOrigin() {
        const explicit = String(window.DOCUSEAL_API_ORIGIN || '').trim().replace(/\/+$/, '');
        if (explicit) return explicit;
        if (window.location.protocol === 'file:') return 'http://127.0.0.1:3020';
        const h = window.location.hostname;
        if ((h === 'localhost' || h === '127.0.0.1') && window.location.port && window.location.port !== '3020') {
            return 'http://127.0.0.1:3020';
        }
        if (window.location.protocol.startsWith('http')) {
            return window.location.origin;
        }
        return '';
    }

    getApiBaseUrl() {
        const origin = this.apiOrigin();
        return origin ? `${origin}/api/booking` : '/api/booking';
    }

    ymdFromDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    formatYmdFromParts(year, monthIndex, day) {
        return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    isPastStoreDate(ymd) {
        const today = this.storeTodayYmd || this.ymdFromDate(new Date());
        return String(ymd).slice(0, 10) < today;
    }

    isBlockedDate(ymd) {
        return this.blockedDates.has(String(ymd).slice(0, 10));
    }

    isSlotStillBookable(dateYmd, timeHm) {
        if (!dateYmd || !timeHm) return false;
        if (this.isPastStoreDate(dateYmd) || this.isBlockedDate(dateYmd)) return false;
        const today = this.storeTodayYmd || this.ymdFromDate(new Date());
        if (dateYmd > today) return true;
        const nowParts = new Intl.DateTimeFormat('en-US', {
            timeZone: this.storeTimezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date());
        const partMap = Object.fromEntries(nowParts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
        const nowHm = `${String(partMap.hour).padStart(2, '0')}:${String(partMap.minute).padStart(2, '0')}`;
        return String(timeHm).slice(0, 5) > nowHm;
    }

    monthRangeYmd(year, month) {
        const first = this.formatYmdFromParts(year, month, 1);
        const lastDay = new Date(year, month + 1, 0).getDate();
        const last = this.formatYmdFromParts(year, month, lastDay);
        return { from: first, to: last };
    }

    init() {
        void this.loadBusinessHours();
    }

    setupModal() {
        if (document.getElementById('notary-booking-modal')) return;

        const modalHTML = `
            <div id="notary-booking-modal" class="notary-modal" aria-hidden="true" role="dialog" aria-labelledby="notary-modal-title">
                <div class="notary-modal-overlay"></div>
                <div class="notary-modal-content">
                    <div class="notary-modal-header">
                        <h2 id="notary-modal-title">Schedule Mobile Notary Appointment</h2>
                        <button type="button" class="notary-modal-close" aria-label="Close">&times;</button>
                    </div>
                    <div class="notary-modal-body">
                        <div id="notary-form-message" class="notary-form-message" role="alert" hidden></div>
                        <div class="notary-step-indicator">
                            <span class="notary-step-dot active" data-step="schedule">1</span>
                            <span class="notary-step-line"></span>
                            <span class="notary-step-dot" data-step="details">2</span>
                        </div>
                        <div id="notary-step-schedule" class="notary-step-panel">
                            <div class="notary-calendar-header">
                                <button type="button" class="notary-calendar-nav" id="notary-prev-month" aria-label="Previous month">&lsaquo;</button>
                                <h3 id="notary-calendar-month-year"></h3>
                                <button type="button" class="notary-calendar-nav" id="notary-next-month" aria-label="Next month">&rsaquo;</button>
                            </div>
                            <div class="notary-calendar-grid" id="notary-calendar-grid"></div>
                            <div class="notary-time-slots" id="notary-time-slots"></div>
                            <div class="notary-step-actions">
                                <button type="button" class="notary-btn notary-btn-secondary" id="notary-cancel-btn">Cancel</button>
                                <button type="button" class="notary-btn notary-btn-primary" id="notary-schedule-continue" disabled>Continue</button>
                            </div>
                        </div>
                        <div id="notary-step-details" class="notary-step-panel" hidden>
                            <p class="notary-selected-summary" id="notary-selected-summary"></p>
                            <form id="notary-booking-form" novalidate>
                                <div class="form-group">
                                    <label for="notary-first-name">First Name *</label>
                                    <input type="text" id="notary-first-name" name="firstName" required autocomplete="given-name">
                                </div>
                                <div class="form-group">
                                    <label for="notary-last-name">Last Name *</label>
                                    <input type="text" id="notary-last-name" name="lastName" required autocomplete="family-name">
                                </div>
                                <div class="form-group">
                                    <label for="notary-email">Email *</label>
                                    <input type="email" id="notary-email" name="email" required autocomplete="email">
                                </div>
                                <div class="form-group">
                                    <label for="notary-phone">Phone *</label>
                                    <input type="tel" id="notary-phone" name="phone" required autocomplete="tel" placeholder="(850) 270-3410" maxlength="14" data-phone-us>
                                </div>
                                <div class="form-group">
                                    <label for="notary-address">Service Address *</label>
                                    <input type="text" id="notary-address" name="serviceAddress" required autocomplete="street-address" placeholder="Where should we meet you?">
                                </div>
                                <div class="form-group">
                                    <label for="notary-cert-count">How many notary stamps do you need? *</label>
                                    <p class="notary-field-hint">Count each signature that needs a notary stamp (also called a seal or certificate). Example: 3 signatures = enter 3.</p>
                                    <input type="number" id="notary-cert-count" name="notaryCertCount" required min="1" max="99" step="1" inputmode="numeric" placeholder="e.g. 2">
                                </div>
                                <div class="form-group">
                                    <label for="notary-notes">Document / Notes</label>
                                    <textarea id="notary-notes" name="notes" rows="2" placeholder="What documents need notarization?"></textarea>
                                </div>
                                <div class="notary-step-actions">
                                    <button type="button" class="notary-btn notary-btn-secondary" id="notary-details-back">Back</button>
                                    <button type="submit" class="notary-btn notary-btn-primary" id="notary-details-continue">Book Appointment</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        if (window.DocuSealPhone) DocuSealPhone.init(document.getElementById('notary-booking-modal'));
    }

    ensureEventListeners() {
        if (this._listenersBound) return;
        const modal = document.getElementById('notary-booking-modal');
        if (!modal) return;

        modal.querySelector('.notary-modal-close')?.addEventListener('click', () => this.closeModal());
        modal.querySelector('.notary-modal-overlay')?.addEventListener('click', () => this.closeModal());
        document.getElementById('notary-cancel-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('notary-prev-month')?.addEventListener('click', () => this.navigateMonth(-1));
        document.getElementById('notary-next-month')?.addEventListener('click', () => this.navigateMonth(1));
        document.getElementById('notary-schedule-continue')?.addEventListener('click', () => this.goToDetailsStep());
        document.getElementById('notary-details-back')?.addEventListener('click', () => this.showStep('schedule'));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) this.closeModal();
        });

        this._listenersBound = true;
    }

    showFormMessage(message, type = 'error') {
        const box = document.getElementById('notary-form-message');
        if (!box) return;
        box.hidden = false;
        box.className = `notary-form-message notary-form-message-${type}`;
        box.textContent = message;
    }

    clearFormMessage() {
        const box = document.getElementById('notary-form-message');
        if (box) {
            box.hidden = true;
            box.textContent = '';
        }
    }

    showStep(step) {
        this._step = step;
        document.getElementById('notary-step-schedule').hidden = step !== 'schedule';
        document.getElementById('notary-step-details').hidden = step !== 'details';
        document.querySelectorAll('.notary-step-dot').forEach((dot) => {
            dot.classList.toggle('active', dot.dataset.step === step);
        });
    }

    async loadBusinessHours() {
        try {
            const res = await fetch(`${this.apiBaseUrl}/hours`);
            if (res.ok) {
                const data = await res.json();
                this.weeklyHours = data.hours;
                if (data.hours?.slotDuration) this.slotDuration = data.hours.slotDuration;
            }
        } catch {
            /* defaults */
        }
    }

    async loadBookingContext(year, month) {
        const range =
            year != null && month != null
                ? this.monthRangeYmd(year, month)
                : this.monthRangeYmd(new Date().getFullYear(), new Date().getMonth());

        try {
            const url = `${this.apiBaseUrl}/booking-context?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&_=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
            if (!res.ok) return;
            const data = await res.json();
            if (data.todayYmd) this.storeTodayYmd = data.todayYmd;
            if (data.storeTimezone) this.storeTimezone = data.storeTimezone;
            this.blockedDates = new Set((data.blockedDates || []).map((d) => String(d).slice(0, 10)));
        } catch {
            /* keep defaults */
        }
    }

    getHoursForDayOfWeek(dayOfWeek) {
        const defaults = {
            0: { open: '08:00', close: '19:00', closed: false },
            1: { open: '08:00', close: '19:00', closed: false },
            2: { open: '08:00', close: '19:00', closed: false },
            3: { open: '08:00', close: '19:00', closed: false },
            4: { open: '08:00', close: '19:00', closed: false },
            5: { open: '08:00', close: '15:00', closed: false },
            6: { open: '00:00', close: '00:00', closed: true },
        };
        if (!this.weeklyHours) return defaults[dayOfWeek] || { closed: true };

        const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        return this.weeklyHours[map[dayOfWeek]] || defaults[dayOfWeek] || { closed: true };
    }

    generateTimeSlots(date) {
        const dayOfWeek = date.getDay();
        const hours = this.getHoursForDayOfWeek(dayOfWeek);
        if (hours.closed) return [];

        const [startHour, startMin] = hours.open.split(':').map(Number);
        const [endHour, endMin] = hours.close.split(':').map(Number);
        const duration = this.slotDuration;
        const slots = [];
        let hour = startHour;
        let minute = startMin;
        const endTotal = endHour * 60 + endMin;

        while (hour * 60 + minute + duration <= endTotal) {
            const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            const dateYmd = this.ymdFromDate(date);
            slots.push({
                time: timeStr,
                available: this.isSlotStillBookable(dateYmd, timeStr),
            });
            minute += duration;
            if (minute >= 60) {
                hour += Math.floor(minute / 60);
                minute %= 60;
            }
        }
        return slots;
    }

    async loadAvailableSlots(date) {
        const dateStr = this.ymdFromDate(date);
        try {
            const res = await fetch(`${this.apiBaseUrl}/available-slots?date=${encodeURIComponent(dateStr)}&_=${Date.now()}`, {
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
            if (res.ok) {
                const data = await res.json();
                this.availableSlots = data.slots || [];
            } else {
                this.availableSlots = this.generateTimeSlots(date);
            }
        } catch {
            this.availableSlots = this.generateTimeSlots(date);
        }
    }

    renderCalendar(year, month) {
        const grid = document.getElementById('notary-calendar-grid');
        const monthYear = document.getElementById('notary-calendar-month-year');
        if (!grid || !monthYear) return;

        this._displayYear = year;
        this._displayMonth = month;

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ];
        monthYear.textContent = `${monthNames[month]} ${year}`;
        grid.innerHTML = '';

        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day) => {
            const header = document.createElement('div');
            header.className = 'calendar-day-header';
            header.textContent = day;
            grid.appendChild(header);
        });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayYmd = this.storeTodayYmd || this.ymdFromDate(new Date());

        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'calendar-day empty';
            grid.appendChild(empty);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.textContent = String(day);
            const cellDate = new Date(year, month, day);
            const cellYmd = this.formatYmdFromParts(year, month, day);
            const hours = this.getHoursForDayOfWeek(cellDate.getDay());

            if (this.isPastStoreDate(cellYmd) || this.isBlockedDate(cellYmd) || hours.closed) {
                cell.classList.add('disabled');
            } else {
                cell.addEventListener('click', () => this.selectDate(cellDate));
                if (cellYmd === todayYmd) cell.classList.add('today');
            }

            if (this.selectedDate && this.ymdFromDate(this.selectedDate) === cellYmd) {
                cell.classList.add('selected');
            }
            grid.appendChild(cell);
        }
    }

    async selectDate(date) {
        this.selectedDate = new Date(date);
        this.selectedTime = null;
        this.clearFormMessage();
        this.renderCalendar(this.selectedDate.getFullYear(), this.selectedDate.getMonth());
        await this.loadAvailableSlots(this.selectedDate);
        this.renderTimeSlots();
        this.updateScheduleContinueButton();
    }

    renderTimeSlots() {
        const container = document.getElementById('notary-time-slots');
        if (!container) return;

        if (!this.selectedDate) {
            container.innerHTML = '<p class="no-date-selected">Please select a date first</p>';
            return;
        }

        if (!this.availableSlots.length) {
            container.innerHTML = '<p class="no-slots">No time slots available for this date</p>';
            return;
        }

        container.innerHTML = '<h4>Available Times</h4><div class="time-slots-grid"></div>';
        const grid = container.querySelector('.time-slots-grid');
        const dateYmd = this.ymdFromDate(this.selectedDate);

        this.availableSlots.forEach((slot) => {
            const bookable = slot.available && this.isSlotStillBookable(dateYmd, slot.time);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'time-slot-btn';
            btn.textContent = this.formatTime(slot.time);
            btn.disabled = !bookable;
            if (!bookable) btn.classList.add('unavailable');
            else btn.addEventListener('click', () => this.selectTime(slot.time));
            if (this.selectedTime === slot.time) btn.classList.add('selected');
            grid.appendChild(btn);
        });
    }

    selectTime(time) {
        this.selectedTime = time;
        this.renderTimeSlots();
        this.updateScheduleContinueButton();
    }

    formatTime(timeStr) {
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    }

    updateScheduleContinueButton() {
        const btn = document.getElementById('notary-schedule-continue');
        if (btn) btn.disabled = !(this.selectedDate && this.selectedTime);
    }

    navigateMonth(direction) {
        let year = this._displayYear ?? new Date().getFullYear();
        let month = this._displayMonth ?? new Date().getMonth();
        const d = new Date(year, month + direction, 1);
        void this.loadBookingContext(d.getFullYear(), d.getMonth());
        this.renderCalendar(d.getFullYear(), d.getMonth());
    }

    goToDetailsStep() {
        if (!this.selectedDate || !this.selectedTime) {
            this.showFormMessage('Please select a date and time.', 'warning');
            return;
        }
        const summary = document.getElementById('notary-selected-summary');
        if (summary) {
            const dateLabel = this.selectedDate.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
            summary.textContent = `${dateLabel} at ${this.formatTime(this.selectedTime)}`;
        }
        this.showStep('details');
    }

    buildConfirmationUrl(details) {
        const params = new URLSearchParams();
        if (details.bookingId != null) params.set('booking', String(details.bookingId));
        if (details.email) params.set('email', details.email);
        if (details.preferredDate) params.set('date', details.preferredDate);
        if (details.preferredTime) params.set('time', details.preferredTime);
        if (details.firstName) params.set('firstName', details.firstName);
        if (details.lastName) params.set('lastName', details.lastName);
        return `confirmation.html?${params.toString()}`;
    }

    async submitBooking(bookingData) {
        const btn = document.getElementById('notary-details-continue');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Booking...';
        }

        try {
            const res = await fetch(`${this.apiBaseUrl}/book`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(bookingData),
            });
            const result = await res.json().catch(() => ({}));

            if (res.status === 201 || (res.ok && result.bookingId)) {
                this._redirecting = true;
                window.location.href = this.buildConfirmationUrl({
                    bookingId: result.bookingId,
                    email: bookingData.email,
                    preferredDate: result.preferredDate || bookingData.preferredDate,
                    preferredTime: result.preferredTime || bookingData.preferredTime,
                    firstName: bookingData.firstName,
                    lastName: bookingData.lastName,
                });
                return;
            }

            this.showFormMessage(result.error || 'Failed to book appointment. Please try again.', res.status === 409 ? 'warning' : 'error');
        } catch (error) {
            console.error('Booking error:', error);
            this.showFormMessage('Could not reach the booking server. Please call (850) 270-3410.', 'error');
        } finally {
            if (!this._redirecting && btn) {
                btn.disabled = false;
                btn.textContent = 'Book Appointment';
            }
        }
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        this.clearFormMessage();

        if (!this.selectedDate || !this.selectedTime) {
            this.showFormMessage('Please select a date and time.', 'warning');
            return;
        }

        const form = document.getElementById('notary-booking-form');
        const fd = new FormData(form);
        const phone = String(fd.get('phone') || '').trim();

        if (!window.DocuSealPhone?.isValidDisplay(phone)) {
            this.showFormMessage('Please enter a valid phone: (850) 270-3410', 'warning');
            return;
        }

        const certCountRaw = String(fd.get('notaryCertCount') || '').trim();
        const notaryCertCount = Number.parseInt(certCountRaw, 10);

        const bookingData = {
            firstName: String(fd.get('firstName') || '').trim(),
            lastName: String(fd.get('lastName') || '').trim(),
            email: String(fd.get('email') || '').trim(),
            phone,
            serviceAddress: String(fd.get('serviceAddress') || '').trim(),
            notaryCertCount,
            notes: String(fd.get('notes') || '').trim(),
            preferredDate: this.ymdFromDate(this.selectedDate),
            preferredTime: this.selectedTime,
        };

        if (!bookingData.firstName || !bookingData.lastName || !bookingData.email || !bookingData.serviceAddress) {
            this.showFormMessage('Please fill in all required fields.', 'warning');
            return;
        }

        if (!Number.isFinite(notaryCertCount) || notaryCertCount < 1 || notaryCertCount > 99) {
            this.showFormMessage('Please enter how many notary stamps you need (1 or more).', 'warning');
            return;
        }

        await this.loadBookingContext(this._displayYear, this._displayMonth);
        await this.submitBooking(bookingData);
    }

    openModal() {
        this.setupModal();
        this.ensureEventListeners();
        const modal = document.getElementById('notary-booking-modal');
        if (!modal) return;

        document.documentElement.classList.add('notary-modal-open');
        document.body.classList.add('notary-modal-open');

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');

        const now = new Date();
        this.selectedDate = null;
        this.selectedTime = null;
        this.showStep('schedule');

        void this.loadBookingContext(now.getFullYear(), now.getMonth()).then(() => {
            this.renderCalendar(now.getFullYear(), now.getMonth());
        });
        this.renderCalendar(now.getFullYear(), now.getMonth());

        const slots = document.getElementById('notary-time-slots');
        if (slots) slots.innerHTML = '<p class="no-date-selected">Please select a date first</p>';
        this.updateScheduleContinueButton();
    }

    closeModal() {
        const modal = document.getElementById('notary-booking-modal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        document.documentElement.classList.remove('notary-modal-open');
        document.body.classList.remove('notary-modal-open');
        document.getElementById('notary-booking-form')?.reset();
        this.selectedDate = null;
        this.selectedTime = null;
        this.clearFormMessage();
    }
}

let notaryBookingSystem;

function openNotaryBooking(e) {
    if (e?.preventDefault) e.preventDefault();
    if (!notaryBookingSystem) notaryBookingSystem = new NotaryBookingSystem();
    notaryBookingSystem.openModal();
}

function handleNotaryFormSubmit(e) {
    if (!e.target || e.target.id !== 'notary-booking-form') return;
    e.preventDefault();
    if (!notaryBookingSystem) notaryBookingSystem = new NotaryBookingSystem();
    notaryBookingSystem.handleFormSubmit(e);
}

document.addEventListener('submit', handleNotaryFormSubmit, true);

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-book-notary], .book-notary-trigger').forEach((el) => {
        el.addEventListener('click', openNotaryBooking);
    });
});

window.openNotaryBooking = openNotaryBooking;
