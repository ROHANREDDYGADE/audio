// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 8001;

// Configure storage for uploaded files
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, 'recording_' + Date.now() + '.wav');
    }
});

const upload = multer({ storage: storage });

// Enable CORS for ESP32
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Route to handle file uploads
app.post('/upload', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    res.json({
        message: 'File uploaded successfully',
        filename: req.file.filename
    });
});

// Route to list all recordings
app.get('/recordings', (req, res) => {
    const dir = 'uploads/';
    fs.readdir(dir, (err, files) => {
        if (err) {
            return res.status(500).send('Error reading directory');
        }
        res.json(files.filter(file => file.endsWith('.wav')));
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
