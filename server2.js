// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Transform } = require('stream');

const app = express();
const port = 8001; // Your port number

// ADPCM decoding tables (same as ESP32)
const stepTable = new Int16Array([
    7, 8, 9, 10, 11, 12, 13, 14,
    16, 17, 19, 21, 23, 25, 28, 31,
    34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143,
    157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658,
    724, 796, 876, 963, 1060, 1166, 1282, 1411,
    1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
    3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
    7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767
]);

const indexTable = new Int8Array([
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
]);

class ADPCMDecoder {
    constructor() {
        this.predictor = 0;
        this.stepIndex = 0;
    }

    decodeSample(code) {
        const step = stepTable[this.stepIndex];
        let predictor = this.predictor;

        // Compute difference
        let difference = step >> 3;
        if (code & 4) difference += step;
        if (code & 2) difference += step >> 1;
        if (code & 1) difference += step >> 2;

        // Add or subtract from predictor
        if (code & 8) {
            predictor -= difference;
        } else {
            predictor += difference;
        }

        // Clamp predictor to 16 bits
        predictor = Math.min(32767, Math.max(-32768, predictor));
        this.predictor = predictor;

        // Update step index
        this.stepIndex += indexTable[code];
        this.stepIndex = Math.min(88, Math.max(0, this.stepIndex));

        return predictor;
    }

    decode(adpcmData) {
        const pcmData = new Int16Array(adpcmData.length * 2);
        let pcmOffset = 0;

        for (let i = 0; i < adpcmData.length; i++) {
            const byte = adpcmData[i];
            // Decode high nibble
            pcmData[pcmOffset++] = this.decodeSample((byte >> 4) & 0x0F);
            // Decode low nibble
            pcmData[pcmOffset++] = this.decodeSample(byte & 0x0F);
        }

        return pcmData;
    }
}

// Configure multer for file uploads
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

// ADPCM to PCM conversion stream
class ADPCMToPCMTransform extends Transform {
    constructor(options = {}) {
        super(options);
        this.decoder = new ADPCMDecoder();
        this.headerWritten = false;
        this.dataSize = 0;
    }

    _transform(chunk, encoding, callback) {
        if (!this.headerWritten) {
            // Process WAV header
            const header = Buffer.alloc(44);
            chunk.copy(header, 0, 0, 44);
            
            // Modify header for PCM format
            header.write('RIFF', 0);
            header.write('WAVE', 8);
            header.write('fmt ', 12);
            header.writeInt32LE(16, 16);  // Subchunk1Size
            header.writeInt16LE(1, 20);   // AudioFormat (PCM)
            header.writeInt16LE(1, 22);   // NumChannels
            header.writeInt32LE(16000, 24); // SampleRate
            header.writeInt32LE(32000, 28); // ByteRate
            header.writeInt16LE(2, 32);    // BlockAlign
            header.writeInt16LE(16, 34);   // BitsPerSample
            header.write('data', 36);
            
            this.push(header);
            this.headerWritten = true;
            
            // Process remaining data
            if (chunk.length > 44) {
                const data = chunk.slice(44);
                const pcmData = this.decoder.decode(data);
                this.push(Buffer.from(pcmData.buffer));
            }
        } else {
            const pcmData = this.decoder.decode(chunk);
            this.push(Buffer.from(pcmData.buffer));
        }
        callback();
    }
}

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Handle file upload
app.post('/upload', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    
    // Convert ADPCM to PCM for web playback
    const inputPath = req.file.path;
    const outputPath = inputPath.replace('.wav', '_pcm.wav');
    
    const readStream = fs.createReadStream(inputPath);
    const writeStream = fs.createWriteStream(outputPath);
    const transform = new ADPCMToPCMTransform();
    
    readStream
        .pipe(transform)
        .pipe(writeStream)
        .on('finish', () => {
            res.json({
                message: 'File uploaded and converted successfully',
                originalFile: req.file.filename,
                pcmFile: path.basename(outputPath)
            });
        })
        .on('error', (err) => {
            console.error('Conversion error:', err);
            res.status(500).send('Error converting file');
        });
});

// Serve audio files
app.get('/audio/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }
    
    res.sendFile(filePath);
});

// Simple frontend
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>ADPCM Audio Recorder</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .recording { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
                audio { width: 100%; }
                .info { color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <h1>Recorded Audio Files</h1>
            <div id="recordings"></div>
            <script>
                function loadRecordings() {
                    fetch('/recordings')
                        .then(response => response.json())
                        .then(files => {
                            const container = document.getElementById('recordings');
                            container.innerHTML = '';
                            files.forEach(file => {
                                const div = document.createElement('div');
                                div.className = 'recording';
                                div.innerHTML = '
                                    <p>${file.name}</p>
                                    <audio controls>
                                        <source src="/audio/${file.pcmName}" type="audio/wav">
                                        Your browser does not support audio playback.
                                    </audio>
                                    <p class="info">
                                        Original Size: ${formatSize(file.originalSize)}<br>
                                        Converted Size: ${formatSize(file.pcmSize)}<br>
                                        Uploaded: ${new Date(file.timestamp).toLocaleString()}
                                    </p>
                                ';
                                container.appendChild(div);
                            });
                        });
                }

                function formatSize(bytes) {
                    const sizes = ['Bytes', 'KB', 'MB'];
                    if (bytes === 0) return '0 Bytes';
                    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
                    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
                }

                loadRecordings();
                setInterval(loadRecordings, 5000);
            </script>
        </body>
        </html>
    `);
});

// List recordings
app.get('/recordings', (req, res) => {
    const dir = 'uploads/';
    fs.readdir(dir, (err, files) => {
        if (err) {
            return res.status(500).send('Error reading directory');
        }
        
        const recordings = files
            .filter(file => file.endsWith('.wav'))
            .map(file => {
                const stats = fs.statSync(path.join(dir, file));
                const pcmFile = file.replace('.wav', '_pcm.wav');
                const pcmStats = fs.existsSync(path.join(dir, pcmFile)) 
                    ? fs.statSync(path.join(dir, pcmFile))
                    : null;
                
                return {
                    name: file,
                    pcmName: pcmFile,
                    originalSize: stats.size,
                    pcmSize: pcmStats ? pcmStats.size : 0,
                    timestamp: stats.mtime
                };
            });
        
        res.json(recordings);
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});