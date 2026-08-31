'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createDb() {
    if (process.env.DB_HOST) {
        return createMysqlDb();
    }
    return createSqliteDb();
}

function createSqliteDb() {
    const Database = require('better-sqlite3');
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'docuseal.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    sqlite.exec(schema);

    const adapter = {
        kind: 'sqlite',
        async query(sql, params = []) {
            const trimmed = sql.trim();
            const upper = trimmed.toUpperCase();
            const stmt = sqlite.prepare(sql);
            if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
                return [stmt.all(...params)];
            }
            const info = stmt.run(...params);
            return [{ insertId: Number(info.lastInsertRowid), affectedRows: info.changes }];
        },
        async execute(sql, params = []) {
            return adapter.query(sql, params);
        },
        close() {
            sqlite.close();
        },
    };

    return adapter;
}

function createMysqlDb() {
    const mysql = require('mysql2/promise');
    let pool;

    const adapter = {
        kind: 'mysql',
        async query(sql, params = []) {
            if (!pool) {
                pool = mysql.createPool({
                    host: process.env.DB_HOST,
                    port: Number(process.env.DB_PORT || 3306),
                    user: process.env.DB_USER,
                    password: process.env.DB_PASSWORD,
                    database: process.env.DB_NAME,
                    waitForConnections: true,
                    connectionLimit: 10,
                });
                await ensureMysqlSchema(pool);
            }
            return pool.query(sql, params);
        },
        async execute(sql, params = []) {
            return adapter.query(sql, params);
        },
        async close() {
            if (pool) await pool.end();
        },
    };

    return adapter;
}

async function ensureMysqlSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INT PRIMARY KEY AUTO_INCREMENT,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            first_name VARCHAR(100) NOT NULL DEFAULT 'Admin',
            last_name VARCHAR(100) NOT NULL DEFAULT 'User',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            last_login TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_calendar_tokens (
            id INT PRIMARY KEY AUTO_INCREMENT,
            admin_user_id INT NOT NULL,
            token VARCHAR(64) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS notary_bookings (
            id INT PRIMARY KEY AUTO_INCREMENT,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            phone VARCHAR(20) NOT NULL,
            service_address TEXT NOT NULL,
            notary_cert_count INT NOT NULL DEFAULT 1,
            preferred_date DATE NOT NULL,
            preferred_time TIME NOT NULL,
            status ENUM('pending', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
            notes TEXT NULL,
            admin_notes TEXT NULL,
            customer_request_type VARCHAR(20) NOT NULL DEFAULT 'none',
            customer_request_notes TEXT NULL,
            requested_date DATE NULL,
            requested_time TIME NULL,
            customer_request_at TIMESTAMP NULL,
            payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_notary_bookings_date (preferred_date),
            INDEX idx_notary_bookings_status (status),
            INDEX idx_notary_bookings_email (email)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS blocked_dates (
            id INT PRIMARY KEY AUTO_INCREMENT,
            block_date DATE NOT NULL UNIQUE,
            reason VARCHAR(500) NULL,
            created_by_admin_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
            INDEX idx_blocked_dates_date (block_date)
        )
    `);
}

function newCalendarToken() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    createDb,
    newCalendarToken,
};
