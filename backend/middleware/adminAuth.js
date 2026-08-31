'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signAdminToken(admin) {
    return jwt.sign(
        { adminId: admin.id, email: admin.email, type: 'admin' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function verifyAdminToken(token) {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin' || !decoded.adminId) {
        throw new Error('Invalid token');
    }
    return decoded;
}

function adminAuthMiddleware(db) {
    return async function adminAuth(req, res, next) {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const decoded = verifyAdminToken(token);
            const [rows] = await db.query(
                'SELECT id, email, first_name, last_name, is_active FROM admin_users WHERE id = ? LIMIT 1',
                [decoded.adminId]
            );
            const admin = rows[0];
            if (!admin || !admin.is_active) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            req.admin = admin;
            next();
        } catch {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    };
}

module.exports = {
    JWT_SECRET,
    signAdminToken,
    verifyAdminToken,
    adminAuthMiddleware,
};
