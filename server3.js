// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');

const app = express();
const port = 8001;

// Add logging middleware
app.use(morgan('dev'));

// Increase payload size limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Health check endpoint
app.post('/health', (req, res) => {
    console.log('Received health check');
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        message: 'Server is ready to receive audio uploads'
    });
});



// Also update your upload endpoint to log more details
app.post('/upload', upload.single('audio'), (req, res) => {
    console.log('Received upload request');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body size:', req.headers['content-length']);
    
    if (!req.file) {
        console.log('No file in request');
        console.log('Body:', req.body);
        return res.status(400).send('No file uploaded.');
    }

    console.log('File received:', {
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
    });

    res.json({
        message: 'File uploaded successfully',
        filename: req.file.filename,
        size: req.file.size
    });
});


// Route to list all recordings
app.get('/recordings', (req, res) => {
    const dir = 'uploads/';
    fs.readdir(dir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return res.status(500).send('Error reading directory');
        }
        const recordings = files
            .filter(file => file.endsWith('.wav'))
            .map(file => {
                const stats = fs.statSync(path.join(dir, file));
                return {
                    name: file,
                    size: stats.size,
                    created: stats.birthtime
                };
            });
        res.json(recordings);
    });
});

// Simple frontend
app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Audio Recordings</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .recording { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
                audio { width: 100%; }
                .info { color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <h1>Uploaded Recordings</h1>
            <div id="status"></div>
            <div id="recordings"></div>
            <script>
                function formatSize(bytes) {
                    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                    if (bytes === 0) return '0 Byte';
                    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
                    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
                }

                function formatDate(dateString) {
                    return new Date(dateString).toLocaleString();
                }

                function loadRecordings() {
                    fetch('/recordings')
                        .then(response => response.json())
                        .then(recordings => {
                            const container = document.getElementById('recordings');
                            container.innerHTML = '';
                            recordings.forEach(recording => {
                                const div = document.createElement('div');
                                div.className = 'recording';
                                div.innerHTML = 
                                    '<p>' + recording.name + '</p>' +
                                    '<audio controls>' +
                                    '<source src="/uploads/' + recording.name + '" type="audio/wav">' +
                                    'Your browser does not support the audio element.' +
                                    '</audio>' +
                                    '<p class="info">' +
                                    'Size: ' + formatSize(recording.size) + '<br>' +
                                    'Created: ' + formatDate(recording.created) +
                                    '</p>';
                                container.appendChild(div);
                            });
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            document.getElementById('status').innerHTML = 
                                '<p style="color: red;">Error loading recordings</p>';
                        });
                }

                fetch('/health')
                    .then(response => response.json())
                    .then(data => {
                        document.getElementById('status').innerHTML = 
                            '<p style="color: green;">Server is running</p>';
                    })
                    .catch(error => {
                        document.getElementById('status').innerHTML = 
                            '<p style="color: red;">Server is not responding</p>';
                    });

                loadRecordings();
                setInterval(loadRecordings, 10000);
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Error handling middleware
// Add better error handling
app.use((err, req, res, next) => {
    console.error('Error occurred:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
    console.log('Server is ready to receive uploads');
});
