// Pure drawing/geometry helpers for the reference-audio overview waveform.
// Stateless: callers pass in the peak data and current loop window, this module
// only draws and converts coordinates. Keeps the alignment UI testable and lets
// the same draw routine run on import, on drag, and on loop-length changes.

const WAVE_COLOR = 'rgba(0,0,0,0.35)';
const WINDOW_FILL = 'rgba(168, 230, 207, 0.45)'; // matches the app's pastel palette
const WINDOW_STROKE = 'rgba(0,0,0,0.4)';

// Set the canvas backing store to match its CSS size * devicePixelRatio so the
// waveform stays crisp on HiDPI displays. Returns the CSS width/height to draw in.
function prepareCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.width;
    const cssHeight = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: cssWidth, height: cssHeight };
}

// Pixel half-width of an edge grab zone, shared by the draw + hit-test so the
// visible handle and the draggable region stay in sync.
export const HANDLE_PX = 8;

export function drawReferenceWave(canvas, peaks, { duration, offsetSeconds, loopSeconds, handles = false }) {
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (!peaks || peaks.length === 0 || !duration) return;

    const mid = height / 2;
    const barWidth = width / peaks.length;

    // Loop window (drawn first, behind the waveform).
    const winStart = (Math.min(offsetSeconds, duration) / duration) * width;
    const winEnd = (Math.min(offsetSeconds + loopSeconds, duration) / duration) * width;
    ctx.fillStyle = WINDOW_FILL;
    ctx.fillRect(winStart, 0, Math.max(2, winEnd - winStart), height);
    ctx.strokeStyle = WINDOW_STROKE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(winStart + 0.75, 0.75, Math.max(2, winEnd - winStart) - 1.5, height - 1.5);

    // Waveform.
    ctx.fillStyle = WAVE_COLOR;
    for (let i = 0; i < peaks.length; i++) {
        const h = Math.max(1, peaks[i] * (height - 2));
        ctx.fillRect(i * barWidth, mid - h / 2, Math.max(1, barWidth - 0.5), h);
    }

    // Resize handles: solid bars on each edge with a grip line, drawn on top.
    if (handles) {
        ctx.fillStyle = WINDOW_STROKE;
        for (const edge of [winStart, winEnd]) {
            const hx = Math.max(0, Math.min(width - HANDLE_PX, edge - HANDLE_PX / 2));
            ctx.fillRect(hx, 0, HANDLE_PX, height);
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx + HANDLE_PX / 2, height * 0.35);
            ctx.lineTo(hx + HANDLE_PX / 2, height * 0.65);
            ctx.stroke();
        }
    }
}

// Given a pixel X, report whether it lands on the start edge, end edge, or the
// body of the loop window — so the crop modal can pick move vs. resize.
export function hitTestWindow(x, canvasWidth, duration, offsetSeconds, loopSeconds) {
    if (!duration) return 'none';
    const winStart = (Math.min(offsetSeconds, duration) / duration) * canvasWidth;
    const winEnd = (Math.min(offsetSeconds + loopSeconds, duration) / duration) * canvasWidth;
    if (Math.abs(x - winStart) <= HANDLE_PX) return 'start';
    if (Math.abs(x - winEnd) <= HANDLE_PX) return 'end';
    if (x > winStart && x < winEnd) return 'body';
    return 'none';
}

// Convert a pixel X to its absolute position in seconds, clamped to the song.
export function pxToSeconds(x, canvasWidth, duration) {
    if (!canvasWidth) return 0;
    return Math.max(0, Math.min(duration, (x / canvasWidth) * duration));
}

// Convert a drag X (in CSS pixels) to a clamped offsetSeconds, centering the loop
// window under the cursor and keeping it fully inside the song.
export function pxToOffset(x, canvasWidth, duration, loopSeconds) {
    if (!duration) return 0;
    const centerSeconds = (x / canvasWidth) * duration;
    let offset = centerSeconds - loopSeconds / 2;
    const maxOffset = Math.max(0, duration - loopSeconds);
    return Math.max(0, Math.min(maxOffset, offset));
}
