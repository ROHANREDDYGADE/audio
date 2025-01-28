from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename
import numpy as np
import os
from datetime import datetime
from io import BytesIO
import whisper

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max-limit

# Create uploads directory if it doesn't exist
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# ADPCM decoding tables (same as ESP32)
step_table = np.array([
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
], dtype=np.int16)

index_table = np.array([
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
], dtype=np.int8)

class ADPCMDecoder:
    def __init__(self):
        self.predictor = 0
        self.step_index = 0

    def decode_sample(self, code):
        step = int(step_table[self.step_index])  # Convert to int for higher precision
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

        # Clamp predictor to 16-bit range
        predictor = max(-32768, min(32767, predictor))
        self.predictor = predictor

        # Update step index
        self.step_index += index_table[code]
        self.step_index = max(0, min(88, self.step_index))

        return predictor

    def decode(self, adpcm_data):
        pcm_data = np.zeros(len(adpcm_data) * 2, dtype=np.int16)  # Final output as int16
        pcm_offset = 0

        for byte in adpcm_data:
            # Decode high nibble
            pcm_data[pcm_offset] = self.decode_sample((byte >> 4) & 0x0F)
            pcm_offset += 1
            # Decode low nibble
            pcm_data[pcm_offset] = self.decode_sample(byte & 0x0F)
            pcm_offset += 1

        return pcm_data


def convert_adpcm_to_pcm(input_file_path):
    with open(input_file_path, 'rb') as f:
        # Read WAV header
        header = bytearray(f.read(44))
        
        # Read ADPCM data
        adpcm_data = np.frombuffer(f.read(), dtype=np.uint8)
    
    # Create decoder and convert data
    decoder = ADPCMDecoder()
    pcm_data = decoder.decode(adpcm_data)
    
    # Create new WAV header for PCM format
    output_header = bytearray(44)
    output_header[0:4] = b'RIFF'
    output_header[8:12] = b'WAVE'
    output_header[12:16] = b'fmt '
    output_header[16:20] = (16).to_bytes(4, 'little')  # Subchunk1Size
    output_header[20:22] = (1).to_bytes(2, 'little')   # AudioFormat (PCM)
    output_header[22:24] = (1).to_bytes(2, 'little')   # NumChannels
    output_header[24:28] = (16000).to_bytes(4, 'little')  # SampleRate
    output_header[28:32] = (32000).to_bytes(4, 'little')  # ByteRate
    output_header[32:34] = (2).to_bytes(2, 'little')    # BlockAlign
    output_header[34:36] = (16).to_bytes(2, 'little')   # BitsPerSample
    output_header[36:40] = b'data'
    output_header[40:44] = len(pcm_data.tobytes()).to_bytes(4, 'little')  # Subchunk2Size
    
    return output_header + pcm_data.tobytes()
model = whisper.load_model("base")

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'audio' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = secure_filename(f"{timestamp}_{file.filename}")
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(input_path)

        try:
            # Convert ADPCM to PCM
            pcm_data = convert_adpcm_to_pcm(input_path)
            
            # Save converted file
            output_filename = filename.replace('.wav', '_pcm.wav')
            output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
            
            with open(output_path, 'wb') as f:
                f.write(pcm_data)

            # Transcribe with Whisper
            
            result = model.transcribe(output_path, language="en")
            transcription = result.get("text", "")
            if transcription == "":
                transcription = "failed to transcribe"

            print(f"Transcription: {transcription}")  # Print transcription to console

            return jsonify({
                'message': 'File uploaded, converted, and transcribed successfully',
                'originalFile': filename,
                'pcmFile': output_filename,
                'transcription': transcription
            })

        except Exception as e:
            return jsonify({'error': str(e)}), 500
        



@app.route('/audio/<filename>')
def get_audio(filename):
    try:
        return send_file(
            os.path.join(app.config['UPLOAD_FOLDER'], filename),
            mimetype='audio/wav'
        )
    except Exception:
        return jsonify({'error': 'File not found'}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8001, debug=True)
