/**
 * GestureControl — Main Application
 * Touchless screen control with hand gestures
 */

const App = (() => {
    let hands = null;
    let engine = null;
    let cursorEl, cursorRing, cursorLabel;
    let trailCanvas, trailCtx;
    let isRunning = false;
    let currentPageIndex = 0;

    // Drag state
    let dragTarget = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Hover state
    let hoveredElement = null;
    let hoverStartTime = 0;
    let dwellClickTime = 1200; // dwell click after 1.2s

    // Mini webcam
    let miniVideo, miniCanvas, miniCtx;

    // Trail
    let trail = [];

    // FPS
    let frames = 0;
    let lastFpsTime = performance.now();
    let fps = 0;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    async function init() {
        try {
            console.log('[GestureControl] Initializing...');
            engine = new GestureEngine();

            // Cursor elements
            cursorEl = $('#gesture-cursor');
            cursorRing = $('#cursor-ring');
            cursorLabel = $('#cursor-label');

            // Trail canvas
            trailCanvas = $('#trail-canvas');
            trailCtx = trailCanvas.getContext('2d');

            // Mini webcam
            miniVideo = $('#mini-webcam');
            miniCanvas = $('#mini-overlay');
            miniCtx = miniCanvas.getContext('2d');

            resizeTrail();
            window.addEventListener('resize', resizeTrail);

            setupInteractiveElements();
            setupUI();
            await initMediaPipe();
            renderTrail();
            console.log('[GestureControl] Ready. Click Start to begin.');
        } catch (err) {
            console.error('[GestureControl] Init error:', err);
            showToast('Failed to initialize: ' + err.message, 'error');
        }
    }

    function resizeTrail() {
        trailCanvas.width = window.innerWidth;
        trailCanvas.height = window.innerHeight;
    }

    // ─── MediaPipe ───────────────────────────────────────────────

    async function initMediaPipe() {
        try {
            const HandsClass = window.Hands;
            if (!HandsClass) {
                throw new Error('MediaPipe Hands not loaded. Check your internet connection.');
            }
            hands = new HandsClass({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
            });
            hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.6,
            });
            hands.onResults(onResults);
            console.log('[GestureControl] MediaPipe Hands loaded.');
        } catch (err) {
            console.error('[GestureControl] MediaPipe init error:', err);
            showToast('MediaPipe failed to load: ' + err.message, 'error');
        }
    }

    // ─── Camera ──────────────────────────────────────────────────

    async function startCamera() {
        if (isRunning) return;
        if (!hands) {
            showToast('MediaPipe not loaded yet. Please wait or refresh.', 'error');
            return;
        }
        try {
            console.log('[GestureControl] Starting camera...');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 320, height: 240, facingMode: 'user' },
            });
            miniVideo.srcObject = stream;
            await miniVideo.play();
            miniCanvas.width = 320;
            miniCanvas.height = 240;
            isRunning = true;
            $('#startBtn').textContent = '⏸ Pause';
            $('#startBtn').classList.add('active');
            $('#status-dot').classList.add('live');
            $('#status-text').textContent = 'Tracking';
            document.body.classList.add('tracking');
            cursorEl.style.display = 'block';
            console.log('[GestureControl] Camera started, beginning detection loop.');
            detectFrame();
        } catch (err) {
            console.error('[GestureControl] Camera error:', err);
            showToast('Camera access denied: ' + err.message, 'error');
        }
    }

    function stopCamera() {
        isRunning = false;
        if (miniVideo.srcObject) {
            miniVideo.srcObject.getTracks().forEach(t => t.stop());
            miniVideo.srcObject = null;
        }
        $('#startBtn').textContent = '▶ Start';
        $('#startBtn').classList.remove('active');
        $('#status-dot').classList.remove('live');
        $('#status-text').textContent = 'Paused';
        document.body.classList.remove('tracking');
        cursorEl.style.display = 'none';
        miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    }

    function toggleCamera() {
        isRunning ? stopCamera() : startCamera();
    }

    // ─── Detection Loop ──────────────────────────────────────────

    async function detectFrame() {
        if (!isRunning) return;

        frames++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
            fps = frames;
            frames = 0;
            lastFpsTime = now;
            $('#fps').textContent = `${fps} FPS`;
        }

        if (miniVideo.readyState >= 2) {
            await hands.send({ image: miniVideo });
        }
        requestAnimationFrame(detectFrame);
    }

    // ─── Results ─────────────────────────────────────────────────

    function onResults(results) {
        try {
            // Draw mini hand overlay
            miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);

            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const landmarks = results.multiHandLandmarks[0];
                drawMiniHand(landmarks);

                const action = engine.process(landmarks);
                if (action) {
                    updateCursor(action);
                    handleAction(action);
                }
            } else {
                const action = engine.process(null);
                if (action) updateCursor(action);
            }
        } catch (err) {
            // Silently handle frame processing errors
            console.debug('[GestureControl] Frame error:', err.message);
        }
    }

    function drawMiniHand(landmarks) {
        const w = miniCanvas.width, h = miniCanvas.height;
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]
        ];

        miniCtx.lineWidth = 2;
        for (const [i, j] of connections) {
            const a = landmarks[i], b = landmarks[j];
            miniCtx.strokeStyle = 'rgba(0, 245, 212, 0.6)';
            miniCtx.beginPath();
            miniCtx.moveTo(a.x * w, a.y * h);
            miniCtx.lineTo(b.x * w, b.y * h);
            miniCtx.stroke();
        }

        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            miniCtx.beginPath();
            miniCtx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
            miniCtx.fillStyle = [4, 8, 12, 16, 20].includes(i) ? '#ff6b9d' : '#00f5d4';
            miniCtx.fill();
        }
    }

    // ─── Cursor ──────────────────────────────────────────────────

    function updateCursor(action) {
        if (!action || !action.handPresent) {
            cursorEl.style.opacity = '0.3';
            cursorLabel.textContent = 'No hand';
            cursorEl.className = 'gesture-cursor idle';
            if (hoveredElement) {
                hoveredElement.classList.remove('gc-hovered');
                hoveredElement = null;
            }
            cursorRing.style.background = 'none';
            return;
        }

        cursorEl.style.opacity = '1';
        const cx = action.cursorX || 0;
        const cy = action.cursorY || 0;
        cursorEl.style.left = `${cx}px`;
        cursorEl.style.top = `${cy}px`;

        // Trail
        trail.push({ x: cx, y: cy, life: 1 });
        if (trail.length > 30) trail.shift();

        // Gesture class
        const gestureMap = {
            'point': 'pointing',
            'click': 'clicking',
            'scroll': 'scrolling',
            'grab': 'grabbing',
            'drag': 'dragging',
            'pinch': 'pinching',
            'swipe_left': 'swiping',
            'swipe_right': 'swiping',
            'swipe_up': 'swiping',
            'swipe_down': 'swiping',
        };

        const cls = gestureMap[action.gesture] || 'pointing';
        cursorEl.className = `gesture-cursor ${cls}`;
        cursorLabel.textContent = formatGesture(action.gesture);

        // Update gesture indicator
        $('#gesture-name').textContent = formatGesture(action.gesture);
        $('#gesture-icon').textContent = gestureIcon(action.gesture);

        // Dwell-click (hover over interactive elements)
        checkHover(cx, cy);
    }

    function formatGesture(g) {
        const map = {
            'point': '☝️ Point',
            'click': '👆 Click!',
            'scroll': '🖐️ Scroll',
            'grab': '✊ Grab',
            'drag': '✊ Drag',
            'pinch': '🤏 Pinch',
            'swipe_left': '👈 Swipe Left',
            'swipe_right': '👉 Swipe Right',
            'swipe_up': '👆 Swipe Up',
            'swipe_down': '👇 Swipe Down',
            'idle': '✋ Idle',
        };
        return map[g] || g;
    }

    function gestureIcon(g) {
        const map = { 'point': '☝️', 'click': '👆', 'scroll': '🖐️', 'grab': '✊', 'drag': '✊', 'pinch': '🤏', 'swipe_left': '👈', 'swipe_right': '👉', 'idle': '✋' };
        return map[g] || '✋';
    }

    // ─── Trail Rendering ────────────────────────────────────────

    function renderTrail() {
        trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);

        for (let i = trail.length - 1; i >= 0; i--) {
            const p = trail[i];
            p.life -= 0.04;
            if (p.life <= 0) { trail.splice(i, 1); continue; }

            trailCtx.beginPath();
            trailCtx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2);
            trailCtx.fillStyle = `rgba(0, 245, 212, ${p.life * 0.4})`;
            trailCtx.fill();
        }

        requestAnimationFrame(renderTrail);
    }

    // ─── Action Handler ──────────────────────────────────────────

    function handleAction(action) {
        switch (action.action) {
            case 'click':
                performClick(action.cursorX, action.cursorY);
                break;
            case 'scroll':
                performScroll(action.scrollDelta);
                break;
            case 'swipe':
                performSwipe(action.direction);
                break;
            case 'grab_start':
                performGrabStart(action.cursorX, action.cursorY);
                break;
            case 'drag':
                performDrag(action.cursorX, action.cursorY);
                break;
            case 'grab_end':
                performGrabEnd();
                break;
        }
    }

    // ─── Click ───────────────────────────────────────────────────

    function performClick(x, y) {
        // Visual feedback
        spawnClickRipple(x, y);
        playClickSound();

        // Find interactive element under cursor
        const elements = document.elementsFromPoint(x, y);
        for (const el of elements) {
            if (el.classList.contains('gc-interactive') || el.closest('.gc-interactive')) {
                const target = el.classList.contains('gc-interactive') ? el : el.closest('.gc-interactive');
                target.click();
                target.classList.add('gc-clicked');
                setTimeout(() => target.classList.remove('gc-clicked'), 300);
                showToast(`Clicked: ${target.dataset.label || target.textContent.slice(0, 20)}`, 'success');
                return;
            }
        }
    }

    function spawnClickRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }

    // ─── Scroll ──────────────────────────────────────────────────

    function performScroll(delta) {
        const scrollContainer = $('#demo-content');
        scrollContainer.scrollBy({ top: delta, behavior: 'auto' });
    }

    // ─── Swipe ───────────────────────────────────────────────────

    function performSwipe(direction) {
        if (direction === 'swipe_left' || direction === 'swipe_right') {
            const pages = $$('.demo-page');
            if (direction === 'swipe_right' && currentPageIndex < pages.length - 1) {
                currentPageIndex++;
            } else if (direction === 'swipe_left' && currentPageIndex > 0) {
                currentPageIndex--;
            }
            updatePages();
            showToast(`Page ${currentPageIndex + 1}`, 'info');
        }

        // Visual swipe indicator
        const indicator = document.createElement('div');
        indicator.className = `swipe-indicator ${direction}`;
        indicator.textContent = direction === 'swipe_left' ? '←' : direction === 'swipe_right' ? '→' : direction === 'swipe_up' ? '↑' : '↓';
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 800);
    }

    function updatePages() {
        $$('.demo-page').forEach((p, i) => {
            p.classList.toggle('active', i === currentPageIndex);
        });
        $$('.page-dot').forEach((d, i) => {
            d.classList.toggle('active', i === currentPageIndex);
        });
    }

    // ─── Grab / Drag ─────────────────────────────────────────────

    function performGrabStart(x, y) {
        const elements = document.elementsFromPoint(x, y);
        for (const el of elements) {
            if (el.classList.contains('gc-draggable') || el.closest('.gc-draggable')) {
                dragTarget = el.classList.contains('gc-draggable') ? el : el.closest('.gc-draggable');
                const rect = dragTarget.getBoundingClientRect();
                dragOffsetX = x - rect.left;
                dragOffsetY = y - rect.top;
                dragTarget.classList.add('gc-being-dragged');
                dragTarget.style.position = 'fixed';
                dragTarget.style.zIndex = '500';
                return;
            }
        }
    }

    function performDrag(x, y) {
        if (!dragTarget) return;
        dragTarget.style.left = `${x - dragOffsetX}px`;
        dragTarget.style.top = `${y - dragOffsetY}px`;
    }

    function performGrabEnd() {
        if (dragTarget) {
            dragTarget.classList.remove('gc-being-dragged');
            dragTarget = null;
        }
    }

    // ─── Hover / Dwell Click ─────────────────────────────────────

    function checkHover(x, y) {
        const elements = document.elementsFromPoint(x, y);
        let found = null;
        for (const el of elements) {
            if (el.classList.contains('gc-interactive') || el.closest('.gc-interactive')) {
                found = el.classList.contains('gc-interactive') ? el : el.closest('.gc-interactive');
                break;
            }
        }

        if (found) {
            if (found !== hoveredElement) {
                // New hover target
                if (hoveredElement) hoveredElement.classList.remove('gc-hovered');
                hoveredElement = found;
                hoveredElement.classList.add('gc-hovered');
                hoverStartTime = Date.now();
            }
            // Dwell click progress
            const elapsed = Date.now() - hoverStartTime;
            const progress = Math.min(1, elapsed / dwellClickTime);
            cursorRing.style.background = `conic-gradient(rgba(0,245,212,0.5) ${progress * 360}deg, transparent ${progress * 360}deg)`;

            if (elapsed >= dwellClickTime) {
                performClick(x, y);
                hoverStartTime = Date.now() + 2000; // prevent rapid re-trigger
            }
        } else {
            if (hoveredElement) {
                hoveredElement.classList.remove('gc-hovered');
                hoveredElement = null;
            }
            cursorRing.style.background = 'none';
        }
    }

    // ─── Sound ───────────────────────────────────────────────────

    let audioCtx = null;
    function playClickSound() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.15);
        } catch (e) { }
    }

    // ─── Interactive Elements ────────────────────────────────────

    function setupInteractiveElements() {
        // Counter cards
        $$('.counter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const counter = btn.closest('.counter-card');
                const valueEl = counter.querySelector('.counter-value');
                const current = parseInt(valueEl.textContent) || 0;
                const delta = btn.dataset.action === 'increment' ? 1 : -1;
                valueEl.textContent = Math.max(0, current + delta);
            });
        });

        // Color cards
        $$('.color-card').forEach(card => {
            card.addEventListener('click', () => {
                const color = card.dataset.color;
                $('#demo-content').style.background = color;
                showToast(`Background: ${card.dataset.label}`, 'info');
                setTimeout(() => {
                    $('#demo-content').style.background = '';
                }, 2000);
            });
        });

        // Toggle switches
        $$('.demo-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('on');
                const label = toggle.dataset.label;
                showToast(`${label}: ${toggle.classList.contains('on') ? 'ON' : 'OFF'}`, 'info');
            });
        });

        // Music player
        const playBtn = $('#play-btn');
        if (playBtn) {
            let playing = false;
            playBtn.addEventListener('click', () => {
                playing = !playing;
                playBtn.textContent = playing ? '⏸' : '▶';
                playBtn.closest('.music-player').classList.toggle('playing', playing);
                showToast(playing ? 'Playing music...' : 'Paused', 'info');
            });
        }

        // Slider
        $$('.gc-slider').forEach(slider => {
            slider.addEventListener('click', (e) => {
                const rect = slider.getBoundingClientRect();
                const pct = ((e.clientX - rect.left) / rect.width) * 100;
                slider.querySelector('.gc-slider-fill').style.width = `${pct}%`;
                slider.querySelector('.gc-slider-thumb').style.left = `${pct}%`;
                const label = slider.dataset.label || 'Slider';
                showToast(`${label}: ${Math.round(pct)}%`, 'info');
            });
        });
    }

    // ─── UI Setup ────────────────────────────────────────────────

    function setupUI() {
        $('#startBtn').addEventListener('click', toggleCamera);

        // Page dots
        $$('.page-dot').forEach((dot, i) => {
            dot.addEventListener('click', () => {
                currentPageIndex = i;
                updatePages();
            });
        });

        // Init audio on first interaction
        document.addEventListener('click', () => {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }, { once: true });
    }

    // ─── Toast ───────────────────────────────────────────────────

    function showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
