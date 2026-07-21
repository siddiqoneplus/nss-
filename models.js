const mongoose = require('mongoose');

// ─── User Schema ───
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'employee'], default: 'employee' },
    displayName: { type: String, default: '' },
    assignedClasses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ClassSection' }],
    createdAt: { type: Date, default: Date.now }
});

// ─── Class Section Schema ───
const classSectionSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },       // e.g. "II-A CSE"
    department: { type: String, default: '' },                   // e.g. "CSE"
    year: { type: Number, default: 1 },                          // 1, 2, 3, 4
    section: { type: String, default: 'A' },                     // A, B, C
    students: [{
        rollNumber: { type: String, required: true },
        name: { type: String, default: '' }
    }],
    createdAt: { type: Date, default: Date.now }
});


// ─── Attendance Record Schema ───
const attendanceSchema = new mongoose.Schema({
    date: { type: String, required: true },                      // YYYY-MM-DD
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSection', required: true },
    className: { type: String, required: true },                 // Denormalized for fast reads
    subject: { type: String, default: '' },
    period: { type: Number, default: 0 },
    presentStudents: [String],                                   // Roll numbers
    absentStudents: [String],                                    // Roll numbers
    totalStudents: { type: Number, default: 0 },
    submittedBy: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ date: 1, classId: 1 });
attendanceSchema.index({ submittedBy: 1 });

// ─── Semester Schema ───
const semesterSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },       // e.g. "Odd Sem 2026"
    startDate: { type: String, default: '' },                    // YYYY-MM-DD
    endDate: { type: String, default: '' },                      // YYYY-MM-DD
    isActive: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// ─── Timetable Schema (per-class, per-semester) ───
const periodSchema = new mongoose.Schema({
    period: { type: Number, required: true },                    // 1–7
    time: { type: String, default: '' },                         // e.g. "09:30-10:30"
    subject: { type: String, default: '' }
}, { _id: false });

const timetableSchema = new mongoose.Schema({
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSection', required: true },
    semesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: true },
    schedule: {
        Mon: [periodSchema],
        Tue: [periodSchema],
        Wed: [periodSchema],
        Thu: [periodSchema],
        Fri: [periodSchema],
        Sat: [periodSchema],
        Sun: [periodSchema]
    },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});
timetableSchema.index({ classId: 1, semesterId: 1 }, { unique: true });

// ─── Alert Schema ───
const alertSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    priority: { type: String, enum: ['info', 'warning', 'urgent'], default: 'info' },
    createdBy: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null }
});
alertSchema.index({ isActive: 1, createdAt: -1 });

// ─── Timetable Override Schema (date-specific) ───
const overrideSchema = new mongoose.Schema({
    date: { type: String, required: true },                      // YYYY-MM-DD
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSection', required: true },
    type: { type: String, enum: ['cancel', 'add', 'replace'], required: true },
    period: { type: Number, required: true },                    // 1–7
    newSubject: { type: String, default: '' },                   // For 'add' / 'replace'
    reason: { type: String, default: '' },                       // Admin note
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
// ─── Attendance Correction Request Schema ───
const correctionRequestSchema = new mongoose.Schema({
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', required: true },
    submittedBy: { type: String, required: true },               // Employee username
    className: { type: String, required: true },
    date: { type: String, required: true },                      // YYYY-MM-DD
    period: { type: Number, default: 0 },
    subject: { type: String, default: 'NSS' },
    originalPresent: [String],
    originalAbsent: [String],
    proposedPresent: [String],
    proposedAbsent: [String],
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    adminNote: { type: String, default: '' },
    actionedBy: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
correctionRequestSchema.index({ attendanceId: 1 });
correctionRequestSchema.index({ submittedBy: 1, status: 1 });
correctionRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = {
    User: mongoose.model('User', userSchema),
    ClassSection: mongoose.model('ClassSection', classSectionSchema),
    Attendance: mongoose.model('Attendance', attendanceSchema),
    Semester: mongoose.model('Semester', semesterSchema),
    Timetable: mongoose.model('Timetable', timetableSchema),
    Alert: mongoose.model('Alert', alertSchema),
    TimetableOverride: mongoose.model('TimetableOverride', overrideSchema),
    CorrectionRequest: mongoose.model('CorrectionRequest', correctionRequestSchema)
};
