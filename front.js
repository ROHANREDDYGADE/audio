// server2.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 8002;

// Serve static files (audio files) from the uploads directory
app.use('/uploads', express.static('uploads'));

// Route to list the top 10 latest recordings
app.get('/latest', (req, res) => {
    const dir = 'uploads/';
    fs.readdir(dir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return res.status(500).send('Error reading directory');
        }

        // Filter files to include only '.wav' files
        const recordings = files.filter(file => file.endsWith('.wav'));

        // Sort the files by creation time (most recent first)
        const sortedRecordings = recordings.map(file => {
            const stats = fs.statSync(path.join(dir, file));
            return {
                name: file,
                size: stats.size,
                created: stats.birthtime
            };
        }).sort((a, b) => b.created - a.created);

        // Limit to top 10 latest recordings
        const top10Recordings = sortedRecordings.slice(0, 10);

        // Send the list of top 10 latest recordings as JSON
        res.json(top10Recordings);
    });
});

// Simple frontend to display the latest recordings
app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Latest Audio Recordings</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .recording { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
                audio { width: 100%; }
                .info { color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <h1>Latest Audio Recordings</h1>
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

                function loadLatestRecordings() {
                    fetch('/latest')
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
                            document.getElementById('recordings').innerHTML = 
                                '<p style="color: red;">Error loading recordings</p>';
                        });
                }

                loadLatestRecordings();
                setInterval(loadLatestRecordings, 10000);
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
