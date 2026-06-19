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
    
    // Setup Export Button
    document.getElementById('export-btn').addEventListener('click', async () => {
        // Generate Share Link
        const json = JSON.stringify(state.notes);
        const b64 = btoa(json);
        const newUrl = `${window.location.origin}${window.location.pathname}?beat=${b64}`;
        
        try {
            await navigator.clipboard.writeText(newUrl);
            const notification = document.getElementById('share-notification');
            notification.classList.remove('hidden');
            notification.classList.add('show');
            setTimeout(() => {
                notification.classList.remove('show');
                notification.classList.add('hidden');
            }, 3000);
        } catch (err) {
            console.error('Failed to copy link', err);
        }
        
        // Bonus: Video Recording (if supported)
        /*
        if (canvasEl.captureStream && Tone.getDestination().context.createMediaStreamDestination) {
            const dest = Tone.getDestination().context.createMediaStreamDestination();
            Tone.getDestination().connect(dest);
            
            const canvasStream = canvasEl.captureStream(30);
            const combinedStream = new MediaStream([
                ...canvasStream.getVideoTracks(),
                ...dest.stream.getAudioTracks()
            ]);
            
            const recorder = new MediaRecorder(combinedStream);
            const chunks = [];
            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'musip-tape.webm';
                a.click();
            };
            
            recorder.start();
            setTimeout(() => recorder.stop(), 5000); // record 5 seconds
        }
        */
    });
}
