// Helpers for the "trim to a loop" step of "Learn a Song". Stem separation is
// the slow part of the flow and its cost scales with clip length, so before
// uploading we let the user crop the dropped mp3 down to a short hook (~10s).
// This module decodes the file, summarises it into peaks for the overview
// waveform, and re-encodes a chosen [start, length) region into a 16-bit PCM
// WAV File that the Demucs backend can read directly. Pure audio/encoding work;
// the modal UI lives in main.js and reuses referenceWave.js to draw.

export async function decodeAudioFile(file) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        return await audioCtx.decodeAudioData(await file.arrayBuffer());
    } finally {
        audioCtx.close();
    }
}

// Reduce an AudioBuffer to `bucketCount` absolute-peak buckets for a cheap
// overview draw (mirrors audio.js getReferencePeaks, but for any buffer).
export function computePeaks(buffer, bucketCount = 800) {
    const data = buffer.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(data.length / bucketCount));
    const peaks = new Float32Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
        const start = i * samplesPerBucket;
        const end = Math.min(data.length, start + samplesPerBucket);
        let peak = 0;
        for (let j = start; j < end; j++) {
            const v = Math.abs(data[j]);
            if (v > peak) peak = v;
        }
        peaks[i] = peak;
    }
    return peaks;
}

// Encode a [startSec, startSec+lengthSec) slice of an AudioBuffer into a
// 16-bit PCM WAV Blob, interleaving all channels at the buffer's native rate.
function sliceToWavBlob(buffer, startSec, lengthSec) {
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const frameCount = Math.max(
        0,
        Math.min(Math.floor(lengthSec * sampleRate), buffer.length - startSample)
    );

    const channels = [];
    for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const view = new DataView(new ArrayBuffer(44 + dataSize));

    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);          // PCM fmt chunk size
    view.setUint16(20, 1, true);           // audio format = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);      // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < frameCount; i++) {
        for (let c = 0; c < numChannels; c++) {
            const sample = Math.max(-1, Math.min(1, channels[c][startSample + i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    return new Blob([view], { type: 'audio/wav' });
}

// Produce a WAV File for the cropped region, named after the source so the
// reference bar and server filename stay recognisable.
export function wavFileFromSlice(buffer, startSec, lengthSec, sourceName) {
    const blob = sliceToWavBlob(buffer, startSec, lengthSec);
    const base = (sourceName || 'clip').replace(/\.[^.]+$/, '');
    return new File([blob], `${base} (clip).wav`, { type: 'audio/wav' });
}
