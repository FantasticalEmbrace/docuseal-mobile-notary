'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const { createDb } = require('../db');

async function main() {
    const email = process.argv[2] || process.env.ADMIN_EMAIL;
    const password = process.argv[3] || process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error('Usage: node scripts/create-admin.js <email> <password>');
        process.exit(1);
    }

    const db = createDb();
    const hash = await bcrypt.hash(password, 12);
    const normalized = String(email).trim().toLowerCase();

    try {
        await db.execute(
            'INSERT INTO admin_users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)',
            [normalized, hash, 'Admin', 'User']
        );
        console.log(`Admin created: ${normalized}`);
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT' || e.code === 'ER_DUP_ENTRY') {
            await db.execute('UPDATE admin_users SET password_hash = ? WHERE LOWER(email) = ?', [hash, normalized]);
            console.log(`Admin password updated: ${normalized}`);
        } else {
            throw e;
        }
    }

    await db.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
