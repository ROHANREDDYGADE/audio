from flask import Flask, send_file, jsonify, render_template_string, request, Response
from datetime import datetime
import os
import mimetypes
from pathlib import Path
import re

app = Flask(__name__)

# Configure maximum content length for large audio files
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

def parse_range_header(range_header, file_size):
    """Parse Range header and return start and end bytes"""
    if not range_header:
        return 0, file_size - 1
    
    match = re.match(r'bytes=(\d+)-(\d*)', range_header)
    if not match:
        return 0, file_size - 1
    
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else file_size - 1
    
    return min(start, file_size - 1), min(end, file_size - 1)

@app.route('/uploads/<path:filename>')
def serve_audio(filename):
    """Serve audio files with byte-range support for better streaming"""
    uploads_dir = Path('uploads')
    file_path = uploads_dir / filename
    
    if not file_path.exists() or not file_path.is_file():
        return "File not found", 404
    
    file_size = file_path.stat().st_size
    range_header = request.headers.get('Range')
    
    # Parse range header if present
    start, end = parse_range_header(range_header, file_size)
    chunk_size = end - start + 1
    
    # Open file in binary mode
    with open(file_path, 'rb') as f:
        f.seek(start)
        data = f.read(chunk_size)
    
    response = Response(
        data,
        206 if range_header else 200,
        mimetype='audio/wav',
        direct_passthrough=True
    )
    
    response.headers['Accept-Ranges'] = 'bytes'
    response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
    response.headers['Content-Length'] = chunk_size
    response.headers['Cache-Control'] = 'no-cache'
    
    return response

@app.route('/latest')
def get_latest_recordings():
    """Get the 10 most recent recordings"""
    uploads_dir = Path('uploads')
    
    if not uploads_dir.exists():
        uploads_dir.mkdir(exist_ok=True)
        return jsonify([])
    
    recordings = []
    
    for file_path in uploads_dir.glob('*.wav'):
        stat = file_path.stat()
        recordings.append({
            'name': file_path.name,
            'size': stat.st_size,
            'created': datetime.fromtimestamp(stat.st_ctime).isoformat()
        })
    
    # Sort by creation time (newest first) and limit to 10
    recordings.sort(key=lambda x: x['created'], reverse=True)
    return jsonify(recordings[:10])

@app.route('/')
def index():
    """Serve the frontend page"""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Latest Audio Recordings</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                margin: 20px;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
            }
            .recording { 
                margin: 10px 0; 
                padding: 15px;
                border: 1px solid #ddd;
                border-radius: 5px;
                background-color: #f9f9f9;
            }
            .audio-container {
                margin: 10px 0;
            }
            audio { 
                width: 100%;
                margin: 10px 0;
            }
            .info { 
                color: #666; 
                font-size: 0.9em;
                margin-top: 5px;
            }
            .error {
                color: #ff0000;
                padding: 10px;
                border: 1px solid #ff0000;
                border-radius: 5px;
                margin: 10px 0;
            }
            .loading {
                text-align: center;
                padding: 20px;
                color: #666;
            }
        </style>
    </head>
    <body>
        <h1>Latest Audio Recordings</h1>
        <div id="recordings">
            <div class="loading">Loading recordings...</div>
        </div>
        <script>
            function formatSize(bytes) {
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                if (bytes === 0) return '0 Bytes';
                const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
                return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
            }

            function formatDate(dateString) {
                return new Date(dateString).toLocaleString();
            }

            async function loadLatestRecordings() {
                try {
                    const response = await fetch('/latest');
                    if (!response.ok) throw new Error('Failed to load recordings');
                    
                    const recordings = await response.json();
                    const container = document.getElementById('recordings');
                    
                    if (recordings.length === 0) {
                        container.innerHTML = '<p>No recordings found.</p>';
                        return;
                    }
                    
                    container.innerHTML = '';
                    recordings.forEach(recording => {
                        const div = document.createElement('div');
                        div.className = 'recording';
                        
                        const audioContainer = document.createElement('div');
                        audioContainer.className = 'audio-container';
                        
                        const audio = document.createElement('audio');
                        audio.controls = true;
                        audio.preload = 'metadata';
                        
                        const source = document.createElement('source');
                        source.src = `/uploads/${recording.name}`;
                        source.type = 'audio/wav';
                        
                        audio.appendChild(source);
                        audio.onerror = function() {
                            audioContainer.innerHTML = '<p class="error">Error loading audio file</p>';
                        };
                        
                        div.innerHTML = `
                            <p><strong>${recording.name}</strong></p>
                            <p class="info">
                                Size: ${formatSize(recording.size)}<br>
                                Created: ${formatDate(recording.created)}
                            </p>
                        `;
                        
                        audioContainer.appendChild(audio);
                        div.appendChild(audioContainer);
                        container.appendChild(div);
                    });
                } catch (error) {
                    console.error('Error:', error);
                    document.getElementById('recordings').innerHTML = 
                        '<div class="error">Error loading recordings</div>';
                }
            }

            // Initial load
            loadLatestRecordings();
            
            // Refresh every 30 seconds
            setInterval(loadLatestRecordings, 30000);
        </script>
    </body>
    </html>
    """
    return render_template_string(html)

if __name__ == '__main__':
    # Create uploads directory if it doesn't exist
    Path('uploads').mkdir(exist_ok=True)
    
    # Run the server
    app.run(host='0.0.0.0', port=8002, threaded=True)
