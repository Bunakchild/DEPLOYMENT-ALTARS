const express = require('express');
const sqlite3 = require('sqlite3').verbose();
// const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const QRCode = require('qrcode');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const schedule = require('node-schedule');
const { app } = require('electron');

const server = express();
const PORT = process.env.PORT || 5000;

// Get the user data path
const userDataPath = app.getPath('userData');

// Initialize database
const db = new sqlite3.Database('student.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        return;
    }
    console.log('Connected to the SQLite database.');
    
    // Drop the students table if it exists to recreate it with the correct schema
    db.run(`DROP TABLE IF EXISTS students`, (err) => {
        if (err) {
            console.error('Error dropping students table:', err);
            return;
        }
        
        // Create the students table with the correct schema
        db.run(`
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                cellphone TEXT NOT NULL,
                email TEXT NOT NULL,
                points INTEGER DEFAULT 0,
                qr_code TEXT
            )
        `, (err) => {
            if (err) {
                console.error('Error creating students table:', err);
                return;
            }
            console.log('Students table created successfully with the correct schema.');
        });
    });
});

// Create uploads directory if it doesn't exist
const uploadDir = path.join(userDataPath, 'assets', 'pic', 'bookcover');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Middleware
server.use(cors());
server.use(bodyParser.json());
server.use(express.static(path.join(__dirname)));

// Initialize PostgreSQL database connection
// const pool = new Pool({
//     user: 'your_username',
//     host: 'your_remote_host',
//     database: 'your_database',
//     password: 'your_password',
//     port: 5000, // Default PostgreSQL port
// });

db.run(`
    CREATE TABLE IF NOT EXISTS books (
        book_id INTEGER PRIMARY KEY AUTOINCREMENT,
        ISBN TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        publication_year INTEGER,
        category TEXT,
        language TEXT,
        shelf_location TEXT,
        copies_available INTEGER,
        qr_code TEXT,
        number_of_page INTEGER,
        tags TEXT,
        image_url TEXT
    )
`);


db.run(`CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    expiry DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES students(id)
)`);

// Create borrowings table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS borrowings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    borrow_date DATETIME NOT NULL,
    due_date DATETIME NOT NULL,
    return_date DATETIME,
    status TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (book_id) REFERENCES books(id)
)`);

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports like 587
    auth: {
        user: 'emanuelrato774@gmail.com', // PAPALITAN TO NG EMAIL (GAWA KA EMAIL FOR APP)
        pass: 'rcgg aiyu yzij tibv' // Replace this with the App Password you generated (SEARCH MO APP PASSWORDS)
    }
});

// API Endpoint to add a student
server.post('/api/students', (req, res) => {
    const { name, username, password, cellphone, email } = req.body;

    if (!name || !username || !password || !cellphone || !email) {
        return res.status(400).json({ error: "Required fields are missing" });
    }

    const query = `INSERT INTO students (name, username, password, cellphone, email, points) VALUES (?, ?, ?, ?, ?, 0)`;
    db.run(query, [name, username, password, cellphone, email], function (err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed")) {
                return res.status(400).json({ error: "Username already exists" });
            }
            console.error("Database error:", err.message);
            return res.status(400).json({ error: err.message });
        }

        const studentId = this.lastID;
        const qrData = JSON.stringify({
            id: studentId,
            name: name,
            username: username
        });

        QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
            if (err) {
                console.error("QR Code generation error:", err);
                return res.status(500).json({ error: "Failed to generate QR code" });
            }

            const updateQuery = `UPDATE students SET qr_code = ? WHERE id = ?`;
            db.run(updateQuery, [qrCodeUrl, studentId], function (err) {
                if (err) {
                    console.error("Database update error:", err.message);
                    return res.status(400).json({ error: "Failed to save QR code to database" });
                }

                res.status(201).json({
                    success: true,
                    student: {
                        id: studentId,
                        name,
                        username,
                        cellphone,
                        email,
                        points: 0,
                        qr_code: qrCodeUrl
                    },
                    message: 'Student added successfully!'
                });
            });
        });
    });
});

// Get all students endpoint
server.get('/api/students', (req, res) => {
    db.all(`SELECT id, name, username, cellphone, email, points, qr_code FROM students`, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(400).json({ error: err.message });
        }
        res.status(200).json({ 
            success: true,
            students: rows || []
        });
    });
});

// Login endpoint
server.post('/api/login', (req, res) => {
    const { role, username, password } = req.body;

    if (role === 'admin' && username === 'Admin' && password === '123') {
        res.json({ success: true, redirect: 'admindashboard.html' });
        return;
    }

    if (role === 'student') {
        db.get(
            'SELECT id, name, username, points FROM students WHERE username = ? AND password = ?',
            [username, password],
            (err, row) => {
                if (err) {
                    res.status(500).json({ success: false, message: 'Database error' });
                    return;
                }

                if (row) {
                    res.json({ 
                        success: true, 
                        redirect: 'studentdashboard.html',
                        userData: {
                            id: row.id,
                            name: row.name,
                            username: row.username,
                            points: row.points
                        }
                    });
                } else {
                    res.json({ success: false, message: 'Invalid credentials' });
                }
            }
        );
    } else {
        res.json({ success: false, message: 'Invalid credentials' });
    }
});

// Modify the books endpoint to handle file upload
server.post('/api/books', upload.single('image'), (req, res) => {
    const { name, author, isbn, publicationYear, category, language, shelfLocation, copiesAvailable, numberOfPages, tags } = req.body;

    if (!name || !author) {
        return res.status(400).json({ error: "Book name and author are required" });
    }

    // Get the image URL if a file was uploaded
    const imageUrl = req.file ? `/assets/pic/bookcover/${req.file.filename}` : null;

    // First insert the book without QR code
    const query = `INSERT INTO books (
        name, 
        author, 
        ISBN, 
        publication_year, 
        category, 
        language, 
        shelf_location, 
        copies_available, 
        number_of_page,
        tags,
        image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(query, [
        name,
        author,
        isbn || null,
        publicationYear || null,
        category || null,
        language || null,
        shelfLocation || null,
        copiesAvailable || null,
        numberOfPages || null,
        tags || null,
        imageUrl
    ], function(err) {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(400).json({ error: err.message });
        }

        const bookId = this.lastID;
        const qrData = `Book ID: ${bookId}\nTitle: ${name}\nAuthor: ${author}`;

        // Generate QR code
        QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
            if (err) {
                console.error("QR Code generation error:", err);
                return res.status(500).json({ error: "Failed to generate QR code" });
            }

            // Update the book with the QR code
            const updateQuery = `UPDATE books SET qr_code = ? WHERE id = ?`;
            db.run(updateQuery, [qrCodeUrl, bookId], function(err) {
                if (err) {
                    console.error("Database update error:", err.message);
                    return res.status(400).json({ error: "Failed to save QR code to database" });
                }

                res.status(201).json({
                    id: bookId,
                    message: 'Book added successfully!',
                    qrCodeUrl: qrCodeUrl,
                    imageUrl: imageUrl
                });
            });
        });
    });
});

// Get all books endpoint
server.get('/api/books', (req, res) => {
    db.all(`SELECT * FROM books`, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(400).json({ error: err.message });
        }
        res.status(200).json({ 
            success: true,
            books: rows || []
        });
    });
});

// Add this endpoint to server.js
server.get('/api/history', (req, res) => {
    // Updated SQL query to join with students and books tables
    const db = new sqlite3.Database('student.db');
    db.all(`
        SELECT 
            b.id,
            b.student_id,
            s.name as student_name,
            s.username,
            b.book_id,
            bk.name as book_name,
            b.borrow_date,
            b.due_date,
            b.return_date,
            b.status
        FROM borrowings b
        LEFT JOIN students s ON b.student_id = s.id
        LEFT JOIN books bk ON b.book_id = bk.id
        ORDER BY b.borrow_date DESC
    `, [], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
        } else {
            res.status(200).json(rows);
        }
    });

    db.close();
});

// Add this endpoint to fetch dashboard data
server.get('/api/dashboard', async (req, res) => {
    try {
        const totalStudents = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM students', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const totalBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM books', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const totalBorrowedBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM borrowings', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const returnedBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM borrowings WHERE return_date IS NOT NULL', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const pendingBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM borrowings WHERE return_date IS NULL', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        res.json({
            totalStudents,
            totalBooks,
            totalBorrowedBooks,
            returnedBooks,
            pendingBooks,
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API Endpoint to delete a student by ID or name
server.delete('/api/students/:idOrName', (req, res) => {
    const { idOrName } = req.params;

    // Check if the parameter is a number (ID) or a string (name)
    const query = isNaN(idOrName) 
        ? `DELETE FROM students WHERE name = ?` 
        : `DELETE FROM students WHERE id = ?`;

    db.run(query, [idOrName], function(err) {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(400).json({ error: "Failed to delete student" });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: "Student not found" });
        }

        res.status(200).json({ message: "Student deleted successfully!" });
    });
});

// Add endpoint to check borrowing status
server.get('/api/borrowings/check', (req, res) => {
    const { studentId, bookId } = req.query;

    if (!studentId || !bookId) {
        return res.status(400).json({ error: "Student ID and Book ID are required" });
    }

    const query = `
        SELECT b.*, s.name as student_name, bk.name as book_name
        FROM borrowings b
        JOIN students s ON b.student_id = s.id
        JOIN books bk ON b.book_id = bk.id
        WHERE b.student_id = ? AND b.book_id = ? AND b.return_date IS NULL
        ORDER BY b.borrow_date DESC
        LIMIT 1
    `;

    db.get(query, [studentId, bookId], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (!row) {
            return res.json({ success: false, message: "No active borrowing found" });
        }

        res.json({
            success: true,
            borrowing: {
                id: row.id,
                student_id: row.student_id,
                student_name: row.student_name,
                book_id: row.book_id,
                book_name: row.book_name,
                borrow_date: row.borrow_date,
                due_date: row.due_date,
                status: row.status
            }
        });
    });
});

// Modify the getCurrentPhilippineTime function
function getCurrentPhilippineTime() {
    // Get current time in Asia/Manila timezone
    const philippineTime = moment().tz('Asia/Manila');
    // Format in SQLite datetime format (YYYY-MM-DD HH:MM:SS)
    return philippineTime.format('YYYY-MM-DD HH:mm:ss');
}

// Add this function after the getCurrentPhilippineTime function
function checkDueBooksAndSendNotifications() {
    const today = moment().tz('Asia/Manila').format('YYYY-MM-DD');
    
    const query = `
        SELECT 
            b.id as borrow_id,
            s.id as student_id,
            s.name as student_name,
            s.email as student_email,
            bk.name as book_name,
            b.due_date
        FROM borrowings b
        JOIN students s ON b.student_id = s.id
        JOIN books bk ON b.book_id = bk.id
        WHERE b.return_date IS NULL
        AND date(b.due_date) = ?
    `;

    db.all(query, [today], (err, rows) => {
        if (err) {
            console.error("Error checking due books:", err);
            return;
        }

        rows.forEach(row => {
            const mailOptions = {
                from: 'emanuelrato774@gmail.com',
                to: row.student_email,
                subject: 'Book Due Today - Library Management System',
                html: `
                    <h2>Book Due Today</h2>
                    <p>Dear ${row.student_name},</p>
                    <p>This is a reminder that your book "${row.book_name}" is due today.</p>
                    <p>Please return the book to the library as soon as possible to avoid any late fees.</p>
                    <p>Thank you for your cooperation!</p>
                    <p>Best regards,<br>Library Management System</p>
                `
            };

            transporter.sendMail(mailOptions, function(error, info) {
                if (error) {
                    console.error('Error sending email:', error);
                } else {
                    console.log('Due date notification sent:', info.response);
                }
            });
        });
    });
}

// Add this after the app.listen call
// Check for due books every day at 9:00 AM
schedule.scheduleJob('0 9 * * *', function() {
    checkDueBooksAndSendNotifications();
});

checkDueBooksAndSendNotifications();

// Add endpoint to handle book returns
server.post('/api/return', (req, res) => {
    const { studentId, bookId, borrowingId } = req.body;

    if (!studentId || !bookId || !borrowingId) {
        return res.status(400).json({ error: "Student ID, Book ID, and Borrowing ID are required" });
    }

    const currentTime = getCurrentPhilippineTime();

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get borrowing details first
        const getBorrowingQuery = `
            SELECT borrow_date, due_date
            FROM borrowings
            WHERE id = ? AND student_id = ? AND book_id = ? AND return_date IS NULL
        `;

        db.get(getBorrowingQuery, [borrowingId, studentId, bookId], (err, borrowing) => {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            if (!borrowing) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "No active borrowing found" });
            }

            // Calculate points based on return time
            let pointsToAdd = 0;
            const borrowDate = new Date(borrowing.borrow_date);
            const dueDate = new Date(borrowing.due_date);
            const returnDate = new Date(currentTime);
            const daysBorrowed = Math.floor((returnDate - borrowDate) / (1000 * 60 * 60 * 24));
            const daysLate = Math.floor((returnDate - dueDate) / (1000 * 60 * 60 * 24));

            if (daysBorrowed < 2) {
                pointsToAdd = 0; // Minimum borrow time not met
            } else if (daysLate > 0) {
                pointsToAdd = -5 * daysLate; // Late return penalty
            } else {
                pointsToAdd = 15; // Early return bonus
            }

            // Update borrowing record
            const updateBorrowingQuery = `
                UPDATE borrowings 
                SET return_date = ?,
                    status = 'returned'
                WHERE id = ? AND student_id = ? AND book_id = ? AND return_date IS NULL
            `;

            db.run(updateBorrowingQuery, [currentTime, borrowingId, studentId, bookId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Database error" });
                }

                // Update student points
                const updatePointsQuery = `
                    UPDATE students 
                    SET points = COALESCE(points, 0) + ?
                    WHERE id = ?
                `;

                db.run(updatePointsQuery, [pointsToAdd, studentId], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error("Database error:", err.message);
                        return res.status(500).json({ error: "Database error" });
                    }

                    db.run('COMMIT');

                    res.json({
                        success: true,
                        message: "Book returned successfully",
                        pointsAwarded: pointsToAdd
                    });
                });
            });
        });
    });
});

// Add endpoint to handle book borrowing
server.post('/api/borrow', (req, res) => {
    const { studentId, bookId } = req.body;

    if (!studentId || !bookId) {
        return res.status(400).json({ error: "Student ID and Book ID are required" });
    }

    const currentTime = getCurrentPhilippineTime();
    const dueDate = moment().tz('Asia/Manila').add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Insert borrowing record
        const borrowQuery = `
            INSERT INTO borrowings (student_id, book_id, borrow_date, due_date, status)
            VALUES (?, ?, ?, ?, 'borrowed')
        `;

        db.run(borrowQuery, [studentId, bookId, currentTime, dueDate], function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            // Award base points for borrowing
            const updatePointsQuery = `
                UPDATE students 
                SET points = COALESCE(points, 0) + 10 
                WHERE id = ?
            `;

            db.run(updatePointsQuery, [studentId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Database error" });
                }

                db.run('COMMIT');

                res.json({
                    success: true,
                    id: this.lastID,
                    message: "Book borrowed successfully",
                    borrowDate: currentTime,
                    dueDate: dueDate,
                    pointsAwarded: 10
                });
            });
        });
    });
});

// Add forgot password endpoint
server.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    // Check if email exists in database
    db.get('SELECT id FROM students WHERE email = ?', [email], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (!row) {
            return res.status(404).json({ success: false, error: 'Email not found' });
        }

        // Generate reset token
        const token = require('crypto').randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 hour from now

        // Store reset token in database
        db.run(
            'INSERT INTO password_resets (user_id, token, expiry) VALUES (?, ?, ?)',
            [row.id, token, expiry.toISOString()],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to store reset token' });
                }

                // Create reset link
                const resetLink = `http://localhost:5000/reset-password.html?token=${token}`;

                // Email content
                const mailOptions = {
                    from: 'emanuelrato774@gmail.com', // Replace with your Gmail address
                    to: email,
                    subject: 'Password Reset Request',
                    html: `
                        <h2>Password Reset Request</h2>
                        <p>You have requested to reset your password. Click the link below to reset it:</p>
                        <p><a href="${resetLink}">${resetLink}</a></p>
                        <p>If you didn't request this, please ignore this email.</p>
                        <p>This link will expire in 1 hour.</p>
                        <p>Best regards,<br>Your Library System</p>
                    `
                };

                // Send email
                transporter.sendMail(mailOptions, function(error, info) {
                    if (error) {
                        console.error('Email error:', error);
                        return res.status(500).json({ 
                            success: false, 
                            error: 'Failed to send email',
                            details: error.message 
                        });
                    }
                    console.log('Email sent:', info.response);
                    res.json({ 
                        success: true, 
                        message: 'Password reset instructions sent to your email'
                    });
                });
            }
        );
    });
});

// Add reset password endpoint
server.post('/api/reset-password', (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ success: false, error: 'Token and password are required' });
    }

    // Verify token and check expiry
    db.get(
        'SELECT user_id FROM password_resets WHERE token = ? AND expiry > datetime("now") AND used = 0',
        [token],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, error: 'Database error' });
            }

            if (!row) {
                return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
            }

            // Update password
            db.run(
                'UPDATE students SET password = ? WHERE id = ?',
                [password, row.user_id],
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ success: false, error: 'Failed to update password' });
                    }

                    // Mark token as used
                    db.run(
                        'UPDATE password_resets SET used = 1 WHERE token = ?',
                        [token],
                        function(err) {
                            if (err) {
                                console.error('Database error:', err);
                            }
                            res.json({ success: true, message: 'Password has been reset successfully' });
                        }
                    );
                }
            );
        }
    );
});

function searchStudents() {
    const input = document.getElementById('studentSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.student-table tbody tr');

    rows.forEach(row => {
        const name = row.cells[1].textContent.toLowerCase(); // Assuming the name is in the second column
        row.style.display = name.includes(input) ? '' : 'none';
    });
}

function searchBooks() {
    const input = document.getElementById('bookSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.books-table tbody tr');

    rows.forEach(row => {
        const name = row.cells[1].textContent.toLowerCase(); // Assuming the name is in the second column
        row.style.display = name.includes(input) ? '' : 'none';
    });
}

// Add endpoint for student-specific borrowing history
server.get('/api/student/history/:studentId', (req, res) => {
    const { studentId } = req.params;
    const { filter } = req.query;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    let query = `
        SELECT 
            b.id,
            b.student_id,
            bk.name as bookTitle,
            b.borrow_date as borrowDate,
            b.due_date as dueDate,
            b.return_date as returnDate,
            b.status
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.id
        WHERE b.student_id = ?
    `;

    // Apply filter if specified
    switch (filter) {
        case 'borrowed':
            query += " AND b.return_date IS NULL";
            break;
        case 'returned':
            query += " AND b.return_date IS NOT NULL";
            break;
        case 'pending':
            query += " AND b.return_date IS NULL AND b.due_date < datetime('now')";
            break;
    }

    query += " ORDER BY b.borrow_date DESC";

    db.all(query, [studentId], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Format dates before sending
        const formattedRows = rows.map(row => ({
            ...row,
            borrowDate: new Date(row.borrowDate).toISOString(),
            dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : null,
            returnDate: row.returnDate ? new Date(row.returnDate).toISOString() : null
        }));

        res.json(formattedRows);
    });
});

// Add endpoint for student dashboard data
server.get('/api/student/dashboard/:studentId', (req, res) => {
    const { studentId } = req.params;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // Get counts for different borrowing statuses
    const query = `
        SELECT 
            COUNT(CASE WHEN return_date IS NULL THEN 1 END) as borrowedCount,
            COUNT(CASE WHEN return_date IS NOT NULL THEN 1 END) as returnedCount,
            COUNT(CASE WHEN return_date IS NULL AND due_date < datetime('now') THEN 1 END) as pendingCount
        FROM borrowings
        WHERE student_id = ?
    `;

    db.get(query, [studentId], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // For now, we'll set points to 0 since points system is not implemented
        const dashboardData = {
            borrowedCount: row.borrowedCount || 0,
            returnedCount: row.returnedCount || 0,
            pendingCount: row.pendingCount || 0,
            points: 0,
            readingTrend: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                values: [0, 0, 0, 0, 0, 0]
            }
        };

        res.json(dashboardData);
    });
});

// Modify the points calculation logic in the student points endpoint
server.get('/api/student/points/:studentId', (req, res) => {
    const { studentId } = req.params;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // Get student's current points
    db.get('SELECT points FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Get points history from borrowings
        const query = `
            SELECT 
                b.borrow_date as date,
                CASE 
                    WHEN b.return_date IS NULL THEN 'Book borrowed'
                    WHEN b.return_date > b.due_date THEN 'Late return'
                    WHEN JULIANDAY(b.return_date) - JULIANDAY(b.borrow_date) <= 2 THEN 'Early return (1-2 days)'
                    ELSE 'On-time return (3-4 days)'
                END as activity,
                CASE 
                    WHEN b.return_date IS NULL THEN 0  -- No points for borrowed books
                    WHEN b.return_date > b.due_date THEN 2  -- 2 points for late return (10 - 8 penalty)
                    WHEN JULIANDAY(b.return_date) - JULIANDAY(b.borrow_date) <= 2 THEN 0  -- No points for early return (1-2 days)
                    ELSE 10  -- Full 10 points for on-time return (3-4 days)
                END as points
            FROM borrowings b
            WHERE b.student_id = ?
            ORDER BY b.borrow_date DESC
        `;

        db.all(query, [studentId], (err, rows) => {
            if (err) {
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            // Format dates and calculate total points
            const history = rows.map(row => ({
                date: new Date(row.date).toISOString(),
                activity: row.activity,
                points: row.points
            }));

            const totalPoints = student.points || 0;

            res.json({
                points: totalPoints,
                history: history
            });
        });
    });
});

// Add endpoint for recommended books
server.get('/api/student/recommended/:studentId', (req, res) => { // ARALIN ALGO TO RECOMMEND BOOKS BASED ON THE STUDENT'S TAGS
    const { studentId } = req.params;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // First, get the tags of books the student has borrowed
    const getStudentTagsQuery = `
        SELECT DISTINCT b.tags
        FROM borrowings br
        JOIN books b ON br.book_id = b.id
        WHERE br.student_id = ? AND b.tags IS NOT NULL
    `;

    db.all(getStudentTagsQuery, [studentId], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Extract all tags from the student's borrowed books
        const studentTags = new Set();
        rows.forEach(row => {
            if (row.tags) {
                const tags = row.tags.split(',').map(tag => tag.trim());
                tags.forEach(tag => studentTags.add(tag));
            }
        });

        // If no tags found, return popular books instead
        // POPULAR BOOKS BASED ON THE NUMBER OF TIMES IT HAS BEEN BORROWED
        if (studentTags.size === 0) {
            const popularBooksQuery = `
                SELECT DISTINCT b.id, b.name as title, b.author,
                    (SELECT COUNT(*) FROM borrowings WHERE book_id = b.id) as borrow_count
                FROM books b
                JOIN borrowings br ON b.id = br.book_id
                WHERE br.student_id != ?
                ORDER BY borrow_count DESC
                LIMIT 6
            `;

            db.all(popularBooksQuery, [studentId], (err, rows) => {
                if (err) {
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Database error" });
                }

                const recommendedBooks = rows.map(book => ({
                    id: book.id,
                    title: book.title,
                    author: book.author,
                    rating: 4.5 // Default rating
                }));

                res.json(recommendedBooks);
            });
            return;
        }

        // Create a query to find books with matching tags
        const tagsArray = Array.from(studentTags);
        const placeholders = tagsArray.map(() => '?').join(',');
        const recommendedBooksQuery = `
            SELECT DISTINCT b.id, b.name as title, b.author,
                (SELECT COUNT(*) FROM borrowings WHERE book_id = b.id) as borrow_count,
                b.tags
            FROM books b
            JOIN borrowings br ON b.id = br.book_id
            WHERE br.student_id != ?
                AND b.tags IS NOT NULL
                AND (
                    ${tagsArray.map(() => "b.tags LIKE '%' || ? || '%'").join(' OR ')}
                )
            ORDER BY borrow_count DESC
            LIMIT 6
        `;

        db.all(recommendedBooksQuery, [studentId, ...tagsArray], (err, rows) => {
            if (err) {
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            // Calculate rating based on matching tags and borrow count
            const recommendedBooks = rows.map(book => {
                const bookTags = book.tags.split(',').map(tag => tag.trim());
                const matchingTagsCount = bookTags.filter(tag => studentTags.has(tag)).length;
                const maxPossibleTags = Math.min(tagsArray.length, bookTags.length);
                const tagMatchRatio = matchingTagsCount / maxPossibleTags;
                
                // Rating is based on tag match ratio (0.5-1.0) plus borrow count influence (0-0.5)
                const baseRating = 0.5 + (tagMatchRatio * 0.5);
                const borrowInfluence = Math.min(book.borrow_count / 10, 0.5);
                const rating = baseRating + borrowInfluence;

                return {
                    id: book.id,
                    title: book.title,
                    author: book.author,
                    rating: Math.min(5, Math.round(rating * 10) / 10)
                };
            });

            res.json(recommendedBooks);
        });
    });
});

// Add endpoint to fetch overdue books
server.get('/api/overdue-books', (req, res) => {
    const query = `
        SELECT 
            b.id,
            bk.name as title,
            s.name as studentName,
            b.borrow_date as borrowDate,
            b.due_date as dueDate,
            b.return_date as returnDate,
            ROUND(JULIANDAY('now') - JULIANDAY(b.due_date)) as daysOverdue
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.id
        JOIN students s ON b.student_id = s.id
        WHERE b.return_date IS NULL 
        AND b.due_date <= datetime('now', 'localtime')
        ORDER BY b.due_date ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        // Format dates and ensure daysOverdue is a positive number
        const overdueBooks = rows.map(row => ({
            ...row,
            borrowDate: new Date(row.borrowDate).toISOString(),
            dueDate: new Date(row.dueDate).toISOString(),
            daysOverdue: Math.max(0, row.daysOverdue)
        }));

        res.json({ success: true, data: overdueBooks });
    });
});

// Add this endpoint before app.listen
server.post('/api/test-due-notifications', (req, res) => {
    checkDueBooksAndSendNotifications();
    res.json({ message: "Due date notification check triggered" });
});

// Modify the update-due-date endpoint
server.post('/api/update-due-date', (req, res) => {
    const { borrowId } = req.body;
    const today = moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss');
    
    if (!borrowId) {
        return res.status(400).json({ error: "Borrow ID is required" });
    }

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Update the due date
        db.run(
            'UPDATE borrowings SET due_date = ? WHERE id = ?',
            [today, borrowId],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Failed to update due date" });
                }

                // Get the student and book details for the notification
                const query = `
                    SELECT 
                        s.name as student_name,
                        s.email as student_email,
                        bk.name as book_name
                    FROM borrowings b
                    JOIN students s ON b.student_id = s.id
                    JOIN books bk ON b.book_id = bk.id
                    WHERE b.id = ?
                `;

                db.get(query, [borrowId], (err, row) => {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error("Database error:", err.message);
                        return res.status(500).json({ error: "Failed to get borrowing details" });
                    }

                    if (row) {
                        // Send email notification
                        const mailOptions = {
                            from: 'emanuelrato774@gmail.com', // BAGUHIN TO EMAIL NG LIBRARY
                            to: row.student_email,
                            subject: 'Book Due Today - Library Management System',
                            html: `
                                <h2>Book Due Today</h2>
                                <p>Dear ${row.student_name},</p>
                                <p>This is a reminder that your book "${row.book_name}" is due today.</p>
                                <p>Please return the book to the library as soon as possible to avoid any late fees.</p>
                                <p>Thank you for your cooperation!</p>
                                <p>Best regards,<br>Library Management System</p>
                            `
                        };

                        transporter.sendMail(mailOptions, function(error, info) {
                            if (error) {
                                console.error('Error sending email:', error);
                            } else {
                                console.log('Due date notification sent:', info.response);
                            }
                            db.run('COMMIT');
                            res.json({ 
                                message: "Due date updated successfully",
                                notificationSent: !error
                            });
                        });
                    } else {
                        db.run('COMMIT');
                        res.json({ message: "Due date updated successfully" });
                    }
                });
            }
        );
    });
});

// Add endpoint for searching students
server.get('/api/students/search', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: "Search query is required" });
    }

    const searchQuery = `
        SELECT id, name, username
        FROM students
        WHERE id = ? OR username LIKE ?
        LIMIT 1
    `;

    db.get(searchQuery, [query, `%${query}%`], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (!row) {
            return res.json({ success: false, error: "Student not found" });
        }

        res.json({
            success: true,
            student: {
                id: row.id,
                name: row.name,
                username: row.username
            }
        });
    });
});

// Add endpoint for searching books
server.get('/api/books/search', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: "Search query is required" });
    }

    const searchQuery = `
        SELECT id, name as title, author
        FROM books
        WHERE id = ? OR name LIKE ?
        LIMIT 1
    `;

    db.get(searchQuery, [query, `%${query}%`], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (!row) {
            return res.json({ success: false, error: "Book not found" });
        }

        res.json({
            success: true,
            book: {
                id: row.id,
                name: row.title,
                author: row.author
            }
        });
    });
});

// Remove the app.listen call and export the app
module.exports = server;


