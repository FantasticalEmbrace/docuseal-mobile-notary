-- DocuSeal Mobile Notary booking schema

CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT 'Admin',
    last_name TEXT NOT NULL DEFAULT 'User',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_calendar_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notary_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    service_address TEXT NOT NULL,
    notary_cert_count INTEGER NOT NULL DEFAULT 1,
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    notes TEXT NULL,
    admin_notes TEXT NULL,
    customer_request_type TEXT NOT NULL DEFAULT 'none',
    customer_request_notes TEXT NULL,
    requested_date TEXT NULL,
    requested_time TEXT NULL,
    customer_request_at TEXT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notary_bookings_date ON notary_bookings(preferred_date);
CREATE INDEX IF NOT EXISTS idx_notary_bookings_status ON notary_bookings(status);
CREATE INDEX IF NOT EXISTS idx_notary_bookings_email ON notary_bookings(email);

CREATE TABLE IF NOT EXISTS blocked_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_date TEXT NOT NULL UNIQUE,
    reason TEXT NULL,
    created_by_admin_id INTEGER NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(block_date);
