from flask import Flask, request, send_file, jsonify
import os
from werkzeug.utils import secure_filename
from pydub import AudioSegment
import wave
import struct
import io

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['ALLOWED_EXTENSIONS'] = {'wav'}

# ADPCM decoding tables (same as ESP32)
stepTable = [
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
]

indexTable = [
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
]


class ADPCMDecoder:
    def __init__(self):
        self.predictor = 0
        self.stepIndex = 0

    def decodeSample(self, code):
        step = stepTable[self.stepIndex]
        predictor = self.predictor

        # Compute difference
        difference = step >> 3
        if code & 4:
            difference += step
        if code & 2:
            difference += step >> 1
        if code & 1:
            difference += step >> 2

        # Add or subtract from predictor
        if code & 8:
            predictor -= difference
        else:
            predictor += difference

        # Clamp predictor to 16 bits
        predictor = min(32767, max(-32768, predictor))
        self.predictor = predictor

        # Update step index
        self.stepIndex += indexTable[code]
        self.stepIndex = min(88, max(0, self.stepIndex))

        return predictor

    def decode(self, adpcmData):
        pcmData = []
        for i in range(0, len(adpcmData), 2):
            byte = adpcmData[i]
            # Decode high nibble
            pcmData.append(self.decodeSample((byte >> 4) & 0x0F))
            # Decode low nibble
            pcmData.append(self.decodeSample(byte & 0x0F))
        return pcmData


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']


def convert_adpcm_to_pcm(adpcm_data):
    decoder = ADPCMDecoder()
    pcm_data = decoder.decode(adpcm_data)

    # Create a WAV file in PCM format
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 2 bytes per sample (16-bit)
        wav_file.setframerate(16000)  # 16kHz sample rate
        wav_file.writeframes(struct.pack('<' + 'h' * len(pcm_data), *pcm_data))
    output.seek(0)
    return output


@app.route('/')
def index():
    return """
        <html>
        <body>
            <h1>Upload ADPCM Audio</h1>
            <form action="/upload" method="post" enctype="multipart/form-data">
                <input type="file" name="audio" accept=".wav">
                <input type="submit">
            </form>
        </body>
        </html>
    """


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'audio' not in request.files:
        return 'No file part', 400
    file = request.files['audio']
    if file.filename == '':
        return 'No selected file', 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # Convert the ADPCM audio to PCM
        with open(filepath, 'rb') as f:
            adpcm_data = bytearray(f.read())
            pcm_audio = convert_adpcm_to_pcm(adpcm_data)

        pcm_filename = filename.replace('.wav', '_pcm.wav')
        pcm_filepath = os.path.join(app.config['UPLOAD_FOLDER'], pcm_filename)

        # Save PCM file
        with open(pcm_filepath, 'wb') as f:
            f.write(pcm_audio.read())

        return jsonify({
            'message': 'File uploaded and converted successfully',
            'originalFile': filename,
            'pcmFile': pcm_filename
        })
    else:
        return 'Invalid file format. Please upload a WAV file.', 400


@app.route('/audio/<filename>')
def get_audio(filename):
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if os.path.exists(file_path):
        return send_file(file_path)
    else:
        return 'File not found', 404


@app.route('/recordings')
def list_recordings():
    recordings = []
    for filename in os.listdir(app.config['UPLOAD_FOLDER']):
        if filename.endswith('.wav'):
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            pcm_filename = filename.replace('.wav', '_pcm.wav')
            pcm_file_path = os.path.join(app.config['UPLOAD_FOLDER'], pcm_filename)
            recordings.append({
                'name': filename,
                'pcmName': pcm_filename,
                'originalSize': os.path.getsize(file_path),
                'pcmSize': os.path.getsize(pcm_file_path) if os.path.exists(pcm_file_path) else 0,
                'timestamp': os.path.getmtime(file_path)
            })
    return jsonify(recordings)


if __name__ == '__main__':
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])
    app.run(host='0.0.0.0', port=8001)
