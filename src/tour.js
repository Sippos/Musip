// Beginner onboarding tour: a lightweight, self-contained coach-mark engine.
//
// It dims the screen, cuts a "spotlight" hole over the UI element a step is
// about, shows a small bubble explaining what to do, and auto-advances when the
// user actually performs the action (each step defines an `isComplete(state)`
// predicate evaluated every frame against the global `state`). Informational
// steps advance on a Next button instead. Nothing here reaches into the rest of
// the app's internals — it only reads `state` and the live DOM/canvas layout —
// so it can't desync the editor.
//
// Public API: startTour(), endTour(). Wired up from main.js (welcome buttons +
// the replay button).

import { state } from './state.js';
import { getTrackLayout } from './pitchMap.js';

const ONBOARDED_KEY = 'musip_onboarded';

// --- DOM handles (created lazily on first run) ---------------------------------
let overlay;      // dim layer holding the spotlight ring
let spotlight;    // the cut-out box (its huge box-shadow dims everything around it)
let bubble;       // the explanatory card
let bubbleTitle, bubbleBody, bubbleCounter, bubbleActions;

let rafId = null;
let currentIndex = -1;
let baselineNoteCount = 0; // captured when a step starts, for "did notes appear" checks

// --- Step helpers --------------------------------------------------------------
function firstTrackNoteCount() {
    const first = state.tracks[0];
    if (!first) return 0;
    return state.notes.filter(n => n.trackId === first.id).length;
}

// Anchors:
//   { dom: 'selector' }            → spotlight the element matching the selector
//   { lane: 0 }                    → spotlight track index N's lane on the canvas
//   (omitted)                      → no spotlight, bubble is centered
const STEPS = [
    {
        id: 'add-track',
        title: 'Add your first track',
        body: 'Tracks are the layers of your song. Tap the <strong>+ Track</strong> tile and pick <strong>Synth</strong> for a melody.',
        anchor: { dom: '.add-track-tile' },
        isComplete: () => state.tracks.length >= 1,
    },
    {
        id: 'first-note',
        title: 'This is your loop',
        body: 'This bar repeats forever. <strong>Click a glowing row</strong> to drop a note — you\'ll hear it the next time the loop comes around.',
        anchor: { lane: 0 },
        isComplete: () => firstTrackNoteCount() >= 1,
    },
    {
        id: 'melody',
        title: 'Make a little melody',
        body: 'Add a few more notes — each row is a different pitch. Higher rows = higher notes. Listen as the loop plays them back.',
        anchor: { lane: 0 },
        isComplete: () => firstTrackNoteCount() >= 3,
    },
    {
        id: 'second-track',
        title: 'Add a beat',
        body: 'A song is layers. Add a second track with the <strong>+ Track</strong> tile — this time choose <strong>Drums</strong>.',
        anchor: { dom: '.add-track-tile' },
        isComplete: () => state.tracks.length >= 2,
    },
    {
        id: 'presets',
        title: 'Borrow a starting point',
        body: 'Open <strong>Menu → Presets</strong> to drop in a ready-made drum beat or chord set. Every note stays editable afterwards.',
        anchor: { dom: '#more-menu-btn' },
        // Completes as soon as they discover the Presets panel, or any preset
        // adds notes to the project.
        isComplete: () => {
            const modal = document.getElementById('presets-modal');
            const open = modal && !modal.classList.contains('hidden');
            return open || state.notes.length > baselineNoteCount;
        },
    },
    {
        id: 'select-tool',
        title: 'The Select tool',
        body: 'Switch on <strong>Select</strong> to grab notes and drag them around. Click it again to go back to drawing notes.',
        anchor: { dom: '#tool-select' },
        isComplete: () => state.activeTool === 'select',
    },
    {
        id: 'scale-snap',
        title: 'Scale Snap keeps you in tune',
        body: 'With this on, every note snaps to the song\'s key — the <strong>green rows</strong> are the in-key notes, so it always sounds right.',
        anchor: { dom: '#tool-scale-lock' },
        manual: true,
    },
    {
        id: 'tempo-key',
        title: 'Tempo & Key',
        body: 'Speed the loop up or down with <strong>BPM</strong>, and change the mood with the <strong>Key</strong> — the green in-key rows follow along.',
        anchor: { dom: '.song-readout' },
        manual: true,
    },
    {
        id: 'finish',
        title: "That's a song! 🎵",
        body: 'You layered tracks, placed notes and shaped the sound. When you\'re ready, try <strong>Learn a Song</strong> to drop in a real track and recreate it by ear.',
        manual: true,
        finish: true,
    },
];

// --- DOM construction ----------------------------------------------------------
function ensureDom() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'tour-overlay';

    spotlight = document.createElement('div');
    spotlight.id = 'tour-spotlight';
    overlay.appendChild(spotlight);

    bubble = document.createElement('div');
    bubble.id = 'tour-bubble';
    bubble.innerHTML = `
        <div class="tour-bubble-counter"></div>
        <h3 class="tour-bubble-title"></h3>
        <p class="tour-bubble-body"></p>
        <div class="tour-bubble-actions"></div>
    `;
    overlay.appendChild(bubble);

    bubbleCounter = bubble.querySelector('.tour-bubble-counter');
    bubbleTitle = bubble.querySelector('.tour-bubble-title');
    bubbleBody = bubble.querySelector('.tour-bubble-body');
    bubbleActions = bubble.querySelector('.tour-bubble-actions');

    document.body.appendChild(overlay);
}

// --- Spotlight + bubble positioning -------------------------------------------
function targetRect(step) {
    if (!step.anchor) return null;

    if (step.anchor.dom) {
        const el = document.querySelector(step.anchor.dom);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    if (typeof step.anchor.lane === 'number') {
        const canvas = document.getElementById('sequencer');
        if (!canvas || !state.tracks[step.anchor.lane]) return null;
        const cRect = canvas.getBoundingClientRect();
        const layout = getTrackLayout(state.tracks, state.camera.scrollY);
        const lane = layout[step.anchor.lane];
        if (!lane) return null;
        const pad = 8;
        return {
            x: cRect.left + pad,
            y: cRect.top + lane.top,
            w: cRect.width - pad * 2,
            h: lane.height,
        };
    }

    return null;
}

function positionSpotlight(rect) {
    if (!rect) {
        spotlight.style.opacity = '0';
        return;
    }
    const pad = 6;
    spotlight.style.opacity = '1';
    spotlight.style.left = `${rect.x - pad}px`;
    spotlight.style.top = `${rect.y - pad}px`;
    spotlight.style.width = `${rect.w + pad * 2}px`;
    spotlight.style.height = `${rect.h + pad * 2}px`;
}

function positionBubble(rect) {
    const margin = 14;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect) {
        // Centered (no anchor): used by the finish step.
        bubble.style.left = `${(vw - bw) / 2}px`;
        bubble.style.top = `${(vh - bh) / 2}px`;
        return;
    }

    // Prefer below the target; flip above if it would overflow the viewport.
    let top = rect.y + rect.h + margin;
    if (top + bh > vh - 8) {
        const above = rect.y - bh - margin;
        top = above >= 8 ? above : Math.max(8, vh - bh - 8);
    }

    // Center horizontally on the target, clamped to the viewport.
    let left = rect.x + rect.w / 2 - bw / 2;
    left = Math.max(8, Math.min(left, vw - bw - 8));

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
}

// --- Step lifecycle ------------------------------------------------------------
function renderActions(step) {
    bubbleActions.innerHTML = '';

    if (step.manual) {
        const next = document.createElement('button');
        next.className = 'tour-btn-primary';
        next.textContent = step.finish ? 'Finish' : 'Got it';
        next.addEventListener('click', () => step.finish ? endTour() : advance());
        bubbleActions.appendChild(next);
    } else {
        const skip = document.createElement('button');
        skip.className = 'tour-link';
        skip.textContent = 'Skip';
        skip.addEventListener('click', advance);
        bubbleActions.appendChild(skip);
    }

    if (!step.finish) {
        const exit = document.createElement('button');
        exit.className = 'tour-link tour-exit';
        exit.textContent = 'Exit tour';
        exit.addEventListener('click', endTour);
        bubbleActions.appendChild(exit);
    }
}

function showStep(index) {
    currentIndex = index;
    const step = STEPS[index];
    baselineNoteCount = state.notes.length;

    bubbleCounter.textContent = `${index + 1} / ${STEPS.length}`;
    bubbleTitle.textContent = step.title;
    bubbleBody.innerHTML = step.body;
    renderActions(step);
}

function advance() {
    if (currentIndex >= STEPS.length - 1) {
        endTour();
        return;
    }
    showStep(currentIndex + 1);
}

// The Add Track / Presets modals and the Menu dropdown open on top of the
// editor. The tour overlay would otherwise dim them and — because the bubble is
// click-catching and lives in a higher stacking context than the menu — block
// the very buttons a step asks the user to press. While one of these is open we
// hide the whole overlay (CSS `.suppressed`), but keep polling so the step still
// advances when the action completes.
function overlayShouldHide() {
    return ['add-track-modal', 'presets-modal', 'more-menu'].some(id => {
        const m = document.getElementById(id);
        return m && !m.classList.contains('hidden');
    });
}

function tick() {
    const step = STEPS[currentIndex];
    if (step) {
        if (overlayShouldHide()) {
            overlay.classList.add('suppressed');
        } else {
            overlay.classList.remove('suppressed');
            const rect = targetRect(step);
            positionSpotlight(rect);
            positionBubble(rect);
        }

        if (!step.manual && typeof step.isComplete === 'function' && step.isComplete(state)) {
            advance();
        }
    }
    rafId = requestAnimationFrame(tick);
}

// --- Public API ----------------------------------------------------------------
export function startTour() {
    ensureDom();
    overlay.classList.remove('suppressed');
    overlay.classList.add('visible');
    showStep(0);
    if (rafId === null) rafId = requestAnimationFrame(tick);
}

export function endTour() {
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    currentIndex = -1;
    if (overlay) overlay.classList.remove('visible');
    try { localStorage.setItem(ONBOARDED_KEY, 'true'); } catch (e) { /* private mode */ }
}
