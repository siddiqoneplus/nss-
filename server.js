const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const compression = require('compression');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'nss_default_secret';

// Models
const { User, ClassSection, Attendance, Semester, Timetable, Alert, TimetableOverride } = require('./models');

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Socket.IO ───
const connectedUsers = {};
io.on('connection', (socket) => {
    socket.on('register', (username) => {
        if (username) {
            connectedUsers[username] = socket.id;
            socket.username = username;
        }
    });
    socket.on('disconnect', () => {
        if (socket.username) delete connectedUsers[socket.username];
    });
});

// ─── MongoDB Connection ───
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/nss_attendance';
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
        console.log('[DB] Connected to MongoDB successfully');
        await seedDatabase();
    })
    .catch(err => {
        console.error('[DB Error] Failed to connect to MongoDB:', err.message);
        console.error('[DB Error] If deployed on Render, check:');
        console.error('  1. MONGO_URI is set in Render Environment Variables');
        console.error('  2. MongoDB Atlas Network Access permits 0.0.0.0/0 (Allow Access from Anywhere)');
    });

mongoose.connection.on('error', err => console.error('[DB Error]', err.message));
mongoose.connection.on('disconnected', () => console.warn('[DB Warning] MongoDB disconnected'));

// ─── Seed Default Data ───
async function seedDatabase() {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
        const defaultUsers = [
            { username: 'admin', password: 'admin123', role: 'admin', displayName: 'Administrator' },
            { username: 'siddiq', password: 'password123', role: 'employee', displayName: 'Siddiq' },
            { username: 'nisanth', password: 'password123', role: 'employee', displayName: 'Nisanth' },
            { username: 'lasya', password: 'password123', role: 'employee', displayName: 'Lasya' },
            { username: 'deepthi', password: 'password123', role: 'employee', displayName: 'Deepthi' }
        ];
        await User.insertMany(defaultUsers);
        console.log('[Seed] Default users created');
    }

    const classCount = await ClassSection.countDocuments();
    if (classCount === 0) {
        const defaultClasses = [
            {
                name: 'II-A CSE', department: 'CSE', year: 2, section: 'A',
                students: [
                    { rollNumber: '24A81A4401', name: 'Student 1' },
                    { rollNumber: '24A81A4402', name: 'Student 2' },
                    { rollNumber: '24A81A4403', name: 'Student 3' },
                    { rollNumber: '24A81A4404', name: 'Student 4' },
                    { rollNumber: '24A81A4405', name: 'Student 5' },
                    { rollNumber: '24A81A4406', name: 'Student 6' },
                    { rollNumber: '24A81A4407', name: 'Student 7' },
                    { rollNumber: '24A81A4408', name: 'Student 8' },
                    { rollNumber: '24A81A4409', name: 'Student 9' },
                    { rollNumber: '24A81A4410', name: 'Student 10' }
                ]
            },
            {
                name: 'II-B CSE', department: 'CSE', year: 2, section: 'B',
                students: [
                    { rollNumber: '24A81A4451', name: 'Student 1' },
                    { rollNumber: '24A81A4452', name: 'Student 2' },
                    { rollNumber: '24A81A4453', name: 'Student 3' },
                    { rollNumber: '24A81A4454', name: 'Student 4' },
                    { rollNumber: '24A81A4455', name: 'Student 5' }
                ]
            },
            {
                name: 'III-A ECE', department: 'ECE', year: 3, section: 'A',
                students: [
                    { rollNumber: '23A81A2301', name: 'Student 1' },
                    { rollNumber: '23A81A2302', name: 'Student 2' },
                    { rollNumber: '23A81A2303', name: 'Student 3' },
                    { rollNumber: '23A81A2304', name: 'Student 4' },
                    { rollNumber: '23A81A2305', name: 'Student 5' }
                ]
            }
        ];
        const created = await ClassSection.insertMany(defaultClasses);
        console.log('[Seed] Default classes created');

        // Assign classes to sample employees
        const siddiq = await User.findOne({ username: 'siddiq' });
        const lasya = await User.findOne({ username: 'lasya' });
        if (siddiq) {
            siddiq.assignedClasses = [created[0]._id, created[1]._id];
            await siddiq.save();
        }
        if (lasya) {
            lasya.assignedClasses = [created[2]._id];
            await lasya.save();
        }
        console.log('[Seed] Sample class assignments done');
    }
}

// ─── Auth Middleware ───
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
}

// ─── Routes ───

// Root
// ─── Health Check ───
app.get('/api/health', (req, res) => {
    const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const dbState = mongoose.connection.readyState;
    const isDbConnected = dbState === 1;

    res.status(isDbConnected ? 200 : 503).json({
        status: isDbConnected ? 'OK' : 'DEGRADED',
        database: {
            state: states[dbState] || 'unknown',
            code: dbState,
            connected: isDbConnected
        },
        env: {
            hasMongoURI: !!process.env.MONGO_URI,
            hasJwtSecret: !!process.env.JWT_SECRET
        },
        uptime: process.uptime()
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/login', async (req, res) => {
    // Check if database is connected before processing
    if (mongoose.connection.readyState !== 1) {
        console.error('[Login Error] Attempted login while MongoDB is not connected.');
        return res.status(503).json({
            error: 'Database not connected. Please ensure MONGO_URI is configured in Render environment variables and MongoDB Atlas IP access includes 0.0.0.0/0.'
        });
    }

    const { username, password } = req.body;
    const inputUser = (username || '').toLowerCase().trim();
    const inputPass = (password || '').trim();

    try {
        const user = await User.findOne({ username: inputUser, password: inputPass });
        if (!user) return res.status(401).json({ error: 'Invalid username or password' });

        const payload = { id: user._id, username: user.username, role: user.role };
        const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '12h' });

        res.json({
            message: 'Login successful',
            token,
            role: user.role,
            username: user.username,
            displayName: user.displayName || user.username
        });
    } catch (err) {
        console.error('[Login Error]', err);
        res.status(500).json({ error: 'Server error: ' + (err.message || 'Unknown error') });
    }
});

app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('assignedClasses', 'name department year section');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            username: user.username,
            role: user.role,
            displayName: user.displayName,
            assignedClasses: user.assignedClasses || []
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// USERS (Admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await User.find({}, '-password').populate('assignedClasses', 'name');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const { username, password, role, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const exists = await User.findOne({ username: username.toLowerCase().trim() });
        if (exists) return res.status(409).json({ error: 'Username already exists' });

        const user = await User.create({
            username: username.toLowerCase().trim(),
            password: password.trim(),
            role: role || 'employee',
            displayName: displayName || username
        });
        res.status(201).json({ message: 'User created', user: { username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create user' });
    }
});

app.patch('/api/users/:id/password', authenticateToken, requireAdmin, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password required' });

    try {
        const user = await User.findByIdAndUpdate(req.params.id, { password: newPassword.trim() }, { new: true });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Password updated' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update password' });
    }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin account' });
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.patch('/api/users/:id/assign-classes', authenticateToken, requireAdmin, async (req, res) => {
    const { classIds } = req.body;
    if (!Array.isArray(classIds)) return res.status(400).json({ error: 'classIds must be an array' });

    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { assignedClasses: classIds },
            { new: true }
        ).populate('assignedClasses', 'name');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Classes assigned', assignedClasses: user.assignedClasses });
    } catch (err) {
        res.status(500).json({ error: 'Failed to assign classes' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLASSES (Admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/classes', authenticateToken, async (req, res) => {
    try {
        const classes = await ClassSection.find().sort({ year: 1, section: 1 });
        res.json(classes);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch classes' });
    }
});

app.post('/api/classes', authenticateToken, requireAdmin, async (req, res) => {
    const { name, department, year, section, students } = req.body;
    if (!name) return res.status(400).json({ error: 'Class name required' });

    try {
        const exists = await ClassSection.findOne({ name: name.trim() });
        if (exists) return res.status(409).json({ error: 'Class name already exists' });

        const cls = await ClassSection.create({
            name: name.trim(),
            department: department || '',
            year: year || 1,
            section: section || 'A',
            students: students || []
        });
        res.status(201).json({ message: 'Class created', class: cls });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create class' });
    }
});

app.patch('/api/classes/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { name, department, year, section, students } = req.body;
    try {
        const updates = {};
        if (name !== undefined) updates.name = name.trim();
        if (department !== undefined) updates.department = department;
        if (year !== undefined) updates.year = year;
        if (section !== undefined) updates.section = section;
        if (students !== undefined) updates.students = students;

        const cls = await ClassSection.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!cls) return res.status(404).json({ error: 'Class not found' });
        res.json({ message: 'Class updated', class: cls });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update class' });
    }
});

app.delete('/api/classes/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const cls = await ClassSection.findByIdAndDelete(req.params.id);
        if (!cls) return res.status(404).json({ error: 'Class not found' });
        // Remove from all users' assignedClasses
        await User.updateMany({}, { $pull: { assignedClasses: req.params.id } });
        res.json({ message: 'Class deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete class' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ATTENDANCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Post attendance
app.post('/api/attendance', authenticateToken, async (req, res) => {
    const { date, classId, subject, period, presentStudents, absentStudents } = req.body;

    if (!date || !classId) return res.status(400).json({ error: 'Date and classId required' });

    const todayStr = new Date().toISOString().split('T')[0];
    if (date > todayStr) {
        return res.status(403).json({ error: 'Cannot post attendance for future dates.' });
    }

    try {
        // Verify class exists
        const cls = await ClassSection.findById(classId);
        if (!cls) return res.status(404).json({ error: 'Class not found' });

        // Non-admin: verify assignment and timetable slot
        if (req.user.role !== 'admin') {
            const user = await User.findById(req.user.id);
            if (!user || !user.assignedClasses.some(c => c.toString() === classId)) {
                return res.status(403).json({ error: 'You are not assigned to this class' });
            }

            // Verify timetable slot (check date-specific overrides FIRST)
            const override = await TimetableOverride.findOne({ date, classId, period: Number(period) });
            if (override) {
                if (override.type === 'cancel') {
                    return res.status(403).json({
                        error: `Period ${period} on ${date} was cancelled by admin${override.reason ? ': ' + override.reason : '.'}`
                    });
                }
                const effSubject = override.newSubject || 'NSS';
                if (effSubject !== 'NSS') {
                    return res.status(403).json({
                        error: `Period ${period} on ${date} is set to "${effSubject}" by admin override (not NSS).`
                    });
                }
            } else {
                // Fallback to regular timetable schedule check
                const [y, m, d] = date.split('-').map(Number);
                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()];
                const activeSem = await Semester.findOne({ isActive: true });
                if (activeSem) {
                    const tt = await Timetable.findOne({ classId, semesterId: activeSem._id });
                    const slot = tt?.schedule?.[dayName]?.find(s => s.period === Number(period));
                    if (!slot || slot.subject !== 'NSS') {
                        return res.status(403).json({
                            error: `No NSS period assigned for ${cls.name} on ${dayName} (Period ${period || 'N/A'}).`
                        });
                    }
                }
            }
        }

        // Check duplicate
        const existing = await Attendance.findOne({ date, classId, period: period || 0 });
        if (existing) {
            return res.status(409).json({ error: `Attendance for ${cls.name} period ${period || 'N/A'} on ${date} already posted` });
        }

        const present = presentStudents || [];
        const absent = absentStudents || [];

        const record = await Attendance.create({
            date,
            classId,
            className: cls.name,
            subject: subject || '',
            period: period || 0,
            presentStudents: present,
            absentStudents: absent,
            totalStudents: present.length + absent.length,
            submittedBy: req.user.username
        });

        // Real-time notify
        io.emit('attendance_posted', { date, classId, className: cls.name, period: period || 0 });

        res.status(201).json({ message: 'Attendance posted successfully', record });
    } catch (err) {
        console.error('[Attendance Post Error]', err);
        res.status(500).json({ error: 'Failed to post attendance' });
    }
});

// Get attendance records (filtered)
app.get('/api/attendance', authenticateToken, async (req, res) => {
    const { date, classId, startDate, endDate, page, limit } = req.query;
    try {
        let query = {};
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        } else if (date) {
            query.date = date;
        }
        if (classId) query.classId = classId;

        let q = Attendance.find(query).sort({ timestamp: -1 });

        if (page && limit) {
            const p = parseInt(page) || 1;
            const l = parseInt(limit) || 20;
            q = q.skip((p - 1) * l).limit(l);
        }

        const records = await q;
        const total = await Attendance.countDocuments(query);

        res.json({ records, total });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

// Get today's status (what's posted, what's pending)
app.get('/api/attendance/status', authenticateToken, async (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    try {
        const records = await Attendance.find({ date });
        res.json(records.map(r => ({
            classId: r.classId,
            className: r.className,
            subject: r.subject,
            period: r.period,
            submittedBy: r.submittedBy,
            totalStudents: r.totalStudents,
            presentCount: r.presentStudents.length
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// Admin: Delete attendance
app.delete('/api/attendance/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const record = await Attendance.findByIdAndDelete(req.params.id);
        if (!record) return res.status(404).json({ error: 'Record not found' });
        io.emit('attendance_deleted', { date: record.date, classId: record.classId });
        res.json({ message: 'Attendance record deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete record' });
    }
});

// Admin: Edit attendance
app.patch('/api/attendance/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { presentStudents, absentStudents, subject, period } = req.body;
    try {
        const updates = {};
        if (presentStudents) updates.presentStudents = presentStudents;
        if (absentStudents) updates.absentStudents = absentStudents;
        if (subject !== undefined) updates.subject = subject;
        if (period !== undefined) updates.period = period;
        if (presentStudents && absentStudents) {
            updates.totalStudents = presentStudents.length + absentStudents.length;
        }

        const record = await Attendance.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!record) return res.status(404).json({ error: 'Record not found' });
        res.json({ message: 'Attendance updated', record });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update record' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const totalClasses = await ClassSection.countDocuments();
        const totalEmployees = await User.countDocuments({ role: 'employee' });
        const todayRecords = await Attendance.find({ date: today });
        const postedClasses = new Set(todayRecords.map(r => r.classId.toString()));

        // Last 7 days trend
        const trend = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const count = await Attendance.countDocuments({ date: dateStr });
            trend.push({ date: dateStr, count });
        }

        res.json({
            totalClasses,
            totalEmployees,
            todayPosted: postedClasses.size,
            todayPending: totalClasses - postedClasses.size,
            todayRecords: todayRecords.length,
            trend
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/dashboard/employee-stats', authenticateToken, requireAdmin, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const employees = await User.find({ role: 'employee' }, '-password').populate('assignedClasses', 'name');
        const todayRecords = await Attendance.find({ date: today });

        const stats = employees.map(emp => {
            const assignedIds = emp.assignedClasses.map(c => c._id.toString());
            const posted = todayRecords.filter(r => r.submittedBy === emp.username);
            const postedClassIds = new Set(posted.map(r => r.classId.toString()));

            return {
                username: emp.username,
                displayName: emp.displayName || emp.username,
                assignedClasses: emp.assignedClasses,
                totalAssigned: assignedIds.length,
                postedToday: postedClassIds.size,
                pending: assignedIds.length - postedClassIds.size
            };
        });

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch employee stats' });
    }
});

// Online users
app.get('/api/online-users', authenticateToken, requireAdmin, (req, res) => {
    res.json({ count: Object.keys(connectedUsers).length, users: Object.keys(connectedUsers) });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEMESTERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/semesters', authenticateToken, async (req, res) => {
    try {
        const semesters = await Semester.find().sort({ createdAt: -1 });
        res.json(semesters);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch semesters' });
    }
});

app.post('/api/semesters', authenticateToken, requireAdmin, async (req, res) => {
    const { name, startDate, endDate } = req.body;
    if (!name) return res.status(400).json({ error: 'Semester name required' });

    try {
        const exists = await Semester.findOne({ name: name.trim() });
        if (exists) return res.status(409).json({ error: 'Semester name already exists' });

        const semester = await Semester.create({
            name: name.trim(),
            startDate: startDate || '',
            endDate: endDate || '',
            isActive: false
        });
        res.status(201).json({ message: 'Semester created', semester });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create semester' });
    }
});

app.patch('/api/semesters/:id/activate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Deactivate all
        await Semester.updateMany({}, { isActive: false });
        // Activate selected
        const semester = await Semester.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
        if (!semester) return res.status(404).json({ error: 'Semester not found' });
        res.json({ message: `"${semester.name}" is now active`, semester });
    } catch (err) {
        res.status(500).json({ error: 'Failed to activate semester' });
    }
});

app.delete('/api/semesters/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const semester = await Semester.findById(req.params.id);
        if (!semester) return res.status(404).json({ error: 'Semester not found' });
        if (semester.isActive) return res.status(400).json({ error: 'Cannot delete the active semester. Activate another first.' });
        // Delete all timetables for this semester
        await Timetable.deleteMany({ semesterId: req.params.id });
        await Semester.findByIdAndDelete(req.params.id);
        res.json({ message: 'Semester and its timetables deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete semester' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TIMETABLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/timetables', authenticateToken, async (req, res) => {
    const { classId, semesterId } = req.query;
    try {
        let query = {};
        if (classId) query.classId = classId;
        if (semesterId) query.semesterId = semesterId;

        // If no semesterId provided, use active semester
        if (!semesterId) {
            const activeSem = await Semester.findOne({ isActive: true });
            if (activeSem) query.semesterId = activeSem._id;
        }

        const timetables = await Timetable.find(query).populate('classId', 'name');
        res.json(timetables);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch timetables' });
    }
});

app.put('/api/timetables', authenticateToken, requireAdmin, async (req, res) => {
    const { classId, semesterId, schedule } = req.body;
    if (!classId || !semesterId || !schedule) {
        return res.status(400).json({ error: 'classId, semesterId, and schedule required' });
    }

    try {
        const timetable = await Timetable.findOneAndUpdate(
            { classId, semesterId },
            { classId, semesterId, schedule, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ message: 'Timetable saved', timetable });
    } catch (err) {
        console.error('[Timetable Save Error]', err);
        res.status(500).json({ error: 'Failed to save timetable' });
    }
});

app.get('/api/timetables/today', authenticateToken, async (req, res) => {
    const { classId, date } = req.query;
    if (!classId) return res.status(400).json({ error: 'classId required' });

    try {
        const activeSem = await Semester.findOne({ isActive: true });
        if (!activeSem) return res.json({ periods: [], message: 'No active semester' });

        const timetable = await Timetable.findOne({ classId, semesterId: activeSem._id });

        // Determine which date to use
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dateObj = date ? new Date(date + 'T00:00:00') : new Date();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = dayNames[dateObj.getDay()];

        let periods = timetable ? [...(timetable.schedule[dayName] || [])] : [];

        // Apply overrides for this date + class
        const overrides = await TimetableOverride.find({ date: targetDate, classId });
        for (const ov of overrides) {
            if (ov.type === 'cancel') {
                // Remove this period
                periods = periods.filter(p => p.period !== ov.period);
            } else if (ov.type === 'add') {
                // Add a new period slot
                periods = periods.filter(p => p.period !== ov.period); // remove existing if any
                periods.push({ period: ov.period, subject: ov.newSubject || 'NSS', time: '', _override: true });
            } else if (ov.type === 'replace') {
                const idx = periods.findIndex(p => p.period === ov.period);
                if (idx >= 0) {
                    periods[idx] = { ...periods[idx].toObject ? periods[idx].toObject() : periods[idx], subject: ov.newSubject || 'NSS', _override: true };
                } else {
                    periods.push({ period: ov.period, subject: ov.newSubject || 'NSS', time: '', _override: true });
                }
            }
        }

        periods.sort((a, b) => a.period - b.period);

        res.json({ day: dayName, periods, semesterName: activeSem.name, overridesApplied: overrides.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch today\'s schedule' });
    }
});

app.get('/api/timetables/verify-slot', authenticateToken, async (req, res) => {
    const { classId, date, period } = req.query;
    if (!classId || !date || !period) {
        return res.status(400).json({ valid: false, reason: 'classId, date, and period required' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (date > todayStr) {
        return res.json({ valid: false, reason: 'Cannot post attendance for future dates.' });
    }

    try {
        const periodNum = parseInt(period);
        const cls = await ClassSection.findById(classId);
        if (!cls) return res.status(404).json({ valid: false, reason: 'Class section not found' });

        // Non-admin: check if user is assigned to this class
        if (req.user.role !== 'admin') {
            const user = await User.findById(req.user.id);
            if (!user || !user.assignedClasses.some(c => c.toString() === classId)) {
                return res.json({ valid: false, reason: `You are not assigned to class ${cls.name}.` });
            }
        }

        // Convert YYYY-MM-DD to day of week
        const [year, month, dayNum] = date.split('-').map(Number);
        const dateObj = new Date(year, month - 1, dayNum);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = dayNames[dateObj.getDay()];

        // ── Check date-specific overrides FIRST (highest priority) ──
        const override = await TimetableOverride.findOne({ date, classId, period: periodNum });

        if (override) {
            if (override.type === 'cancel') {
                return res.json({
                    valid: false,
                    overridden: true,
                    reason: `⛔ Period ${periodNum} cancelled by admin${override.reason ? ': ' + override.reason : '.'}`
                });
            }
            if (override.type === 'add' || override.type === 'replace') {
                const effectiveSubject = override.newSubject || 'NSS';
                if (effectiveSubject !== 'NSS') {
                    return res.json({
                        valid: false,
                        overridden: true,
                        reason: `Override: Period ${periodNum} is set to "${effectiveSubject}" (not NSS)${override.reason ? ' — ' + override.reason : ''}.`
                    });
                }

                // Check if attendance is already posted
                const existing = await Attendance.findOne({ date, classId, period: periodNum });
                if (existing) {
                    return res.json({
                        valid: false,
                        alreadyPosted: true,
                        reason: `Attendance for ${cls.name} Period ${periodNum} on ${date} has already been posted.`
                    });
                }

                return res.json({
                    valid: true,
                    overridden: true,
                    className: cls.name,
                    day: dayName,
                    period: periodNum,
                    subject: effectiveSubject,
                    time: '',
                    overrideReason: override.reason || `${override.type === 'add' ? 'Extra' : 'Replaced'} NSS period added by admin`
                });
            }
        }

        // ── Regular timetable check (fallback) ──
        const activeSem = await Semester.findOne({ isActive: true });
        if (!activeSem) {
            return res.json({ valid: false, reason: 'No active semester timetable found.' });
        }

        const tt = await Timetable.findOne({ classId, semesterId: activeSem._id });
        if (!tt || !tt.schedule || !tt.schedule[dayName]) {
            return res.json({ valid: false, reason: `No timetable configured for ${cls.name} on ${dayName}.` });
        }

        const slot = (tt.schedule[dayName] || []).find(s => s.period === periodNum);
        if (!slot || slot.subject !== 'NSS') {
            return res.json({
                valid: false,
                reason: `No NSS period assigned for ${cls.name} on ${dayName} (Period ${periodNum}).`
            });
        }

        // Check if attendance is already posted for this date & period & class
        const existing = await Attendance.findOne({ date, classId, period: periodNum });
        if (existing) {
            return res.json({
                valid: false,
                alreadyPosted: true,
                reason: `Attendance for ${cls.name} Period ${periodNum} on ${date} has already been posted.`
            });
        }

        res.json({
            valid: true,
            className: cls.name,
            day: dayName,
            period: periodNum,
            subject: slot.subject,
            time: slot.time
        });
    } catch (err) {
        console.error('[Verify Slot Error]', err);
        res.status(500).json({ valid: false, reason: 'Server error verifying schedule.' });
    }
});

app.post('/api/timetables/clone', authenticateToken, requireAdmin, async (req, res) => {
    const { fromSemesterId, toSemesterId } = req.body;
    if (!fromSemesterId || !toSemesterId) {
        return res.status(400).json({ error: 'fromSemesterId and toSemesterId required' });
    }
    if (fromSemesterId === toSemesterId) {
        return res.status(400).json({ error: 'Cannot clone to the same semester' });
    }

    try {
        const sourceTimetables = await Timetable.find({ semesterId: fromSemesterId });
        if (sourceTimetables.length === 0) {
            return res.status(404).json({ error: 'No timetables found in source semester' });
        }

        let cloned = 0;
        for (const tt of sourceTimetables) {
            await Timetable.findOneAndUpdate(
                { classId: tt.classId, semesterId: toSemesterId },
                {
                    classId: tt.classId,
                    semesterId: toSemesterId,
                    schedule: tt.schedule,
                    updatedAt: new Date()
                },
                { upsert: true }
            );
            cloned++;
        }

        res.json({ message: `${cloned} timetable(s) cloned successfully` });
    } catch (err) {
        console.error('[Clone Error]', err);
        res.status(500).json({ error: 'Failed to clone timetables' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TIMETABLE OVERRIDES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// List overrides (filterable by date, classId)
app.get('/api/timetable-overrides', authenticateToken, async (req, res) => {
    const { date, classId, fromDate } = req.query;
    try {
        let query = {};
        if (date) query.date = date;
        if (classId) query.classId = classId;
        // For listing upcoming overrides
        if (fromDate) query.date = { $gte: fromDate };

        const overrides = await TimetableOverride.find(query)
            .populate('classId', 'name')
            .sort({ date: 1, period: 1 })
            .limit(100);
        res.json(overrides);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch overrides' });
    }
});

// Create override (admin only)
app.post('/api/timetable-overrides', authenticateToken, requireAdmin, async (req, res) => {
    const { date, classId, type, period, newSubject, reason } = req.body;
    if (!date || !classId || !type || !period) {
        return res.status(400).json({ error: 'date, classId, type, and period are required' });
    }
    if ((type === 'add' || type === 'replace') && !newSubject) {
        return res.status(400).json({ error: 'newSubject is required for add/replace overrides' });
    }

    try {
        // Check if an override already exists for this exact slot
        const existing = await TimetableOverride.findOne({ date, classId, period: parseInt(period) });
        if (existing) {
            return res.status(409).json({ error: `An override already exists for this class on ${date} Period ${period}. Delete it first.` });
        }

        const override = await TimetableOverride.create({
            date,
            classId,
            type,
            period: parseInt(period),
            newSubject: newSubject || '',
            reason: (reason || '').trim(),
            createdBy: req.user.username
        });

        const populated = await TimetableOverride.findById(override._id).populate('classId', 'name');
        io.emit('timetable_override', { action: 'created', override: populated });
        res.status(201).json({ message: 'Override created', override: populated });
    } catch (err) {
        console.error('[Override Create Error]', err);
        res.status(500).json({ error: 'Failed to create override' });
    }
});

// Delete override (admin only)
app.delete('/api/timetable-overrides/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const override = await TimetableOverride.findByIdAndDelete(req.params.id);
        if (!override) return res.status(404).json({ error: 'Override not found' });

        io.emit('timetable_override', { action: 'deleted', overrideId: req.params.id });
        res.json({ message: 'Override deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete override' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ALERTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Get all alerts (admin sees all, employees see active only)
app.get('/api/alerts', authenticateToken, async (req, res) => {
    try {
        let query = {};
        if (req.user.role !== 'admin') {
            query.isActive = true;
        }
        const alerts = await Alert.find(query).sort({ createdAt: -1 }).limit(50);
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

// Create alert (admin only)
app.post('/api/alerts', authenticateToken, requireAdmin, async (req, res) => {
    const { title, message, priority, expiresAt } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message required' });

    try {
        const alert = await Alert.create({
            title: title.trim(),
            message: message.trim(),
            priority: priority || 'info',
            createdBy: req.user.username,
            expiresAt: expiresAt || null
        });

        // Broadcast to all connected clients
        io.emit('new_alert', {
            _id: alert._id,
            title: alert.title,
            message: alert.message,
            priority: alert.priority,
            createdAt: alert.createdAt
        });

        res.status(201).json({ message: 'Alert sent', alert });
    } catch (err) {
        console.error('[Alert Create Error]', err);
        res.status(500).json({ error: 'Failed to create alert' });
    }
});

// Toggle alert active status (admin only)
app.patch('/api/alerts/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const alert = await Alert.findById(req.params.id);
        if (!alert) return res.status(404).json({ error: 'Alert not found' });

        alert.isActive = !alert.isActive;
        await alert.save();

        if (!alert.isActive) {
            io.emit('alert_dismissed', { _id: alert._id });
        }

        res.json({ message: `Alert ${alert.isActive ? 'activated' : 'deactivated'}`, alert });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update alert' });
    }
});

// Delete alert (admin only)
app.delete('/api/alerts/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const alert = await Alert.findByIdAndDelete(req.params.id);
        if (!alert) return res.status(404).json({ error: 'Alert not found' });

        io.emit('alert_dismissed', { _id: alert._id });
        res.json({ message: 'Alert deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete alert' });
    }
});

// ─── Start Server ───
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
});
