import { state } from './state.js';
import * as Tone from 'tone';

export function initExport(canvasEl) {
    // 1. Share Link via URL Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const beatParam = urlParams.get('beat');
    
    if (beatParam) {
        try {
            const decoded = atob(beatParam);
            const parsedNotes = JSON.parse(decoded);
            if (Array.isArray(parsedNotes)) {
                state.notes = parsedNotes;
                import('./audio.js').then(module => {
                    module.syncAudioPart(state.notes);
                });
            }
        } catch (e) {
            console.error("Failed to load beat from URL", e);
        }
    }
    
    let isRecording = false;
    let stopRecordingResolver = null;
    let originalText = '';
    let originalBg = '';
    let originalColor = '';
    
    document.getElementById('export-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        
        if (isRecording) {
            if (stopRecordingResolver) {
                stopRecordingResolver();
            }
            return;
        }
        
        if (!state.isPlaying) {
            alert("Please make sure the session is playing before exporting!");
            return;
        }
        
        originalText = btn.textContent;
        originalBg = btn.style.backgroundColor;
        originalColor = btn.style.color;
        
        btn.textContent = 'Stop Recording';
        btn.style.backgroundColor = '#ff7675';
        btn.style.color = '#ffffff';
        isRecording = true;
        
        try {
            const audioModule = await import('./audio.js');
            const masterRecorder = audioModule.masterRecorder;
            
            // Start recording
            masterRecorder.start();
            
            // Wait until user clicks "Stop Recording"
            await new Promise(resolve => {
                stopRecordingResolver = resolve;
            });
            
            // Stop recording
            const recording = await masterRecorder.stop();
            stopRecordingResolver = null;
            
            // Create a download link for the webm file
            const url = URL.createObjectURL(recording);
            const anchor = document.createElement('a');
            anchor.download = 'musip-tape.webm';
            anchor.href = url;
            anchor.click();
            URL.revokeObjectURL(url);
            
        } catch (err) {
            console.error('Failed to record audio', err);
            alert('Recording failed. Make sure audio is playing.');
        } finally {
            btn.textContent = originalText;
            btn.style.backgroundColor = originalBg;
            btn.style.color = originalColor;
            isRecording = false;
        }
    });
}
