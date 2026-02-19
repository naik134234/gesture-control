/**
 * GestureEngine — Touchless Screen Control
 * Translates MediaPipe hand landmarks into UI control actions:
 *   - Cursor movement (index finger tracking)
 *   - Air Click (thumb + index pinch)
 *   - Scroll (open palm vertical movement)
 *   - Swipe (quick horizontal hand sweep)
 *   - Grab/Drag (make fist to grab, move to drag)
 *   - Zoom (pinch distance change)
 */

class GestureEngine {
    constructor() {
        // Smoothing
        this.smoothX = 0;
        this.smoothY = 0;
        this.smoothingFactor = 0.35;

        // Click detection
        this.isPinching = false;
        this.pinchStartTime = 0;
        this.pinchThreshold = 0.06;
        this.clickCooldown = 400;
        this.lastClickTime = 0;

        // Scroll
        this.isScrolling = false;
        this.scrollBaseY = 0;
        this.scrollSensitivity = 15;
        this.lastScrollY = 0;

        // Swipe
        this.swipeBuffer = [];
        this.swipeBufferSize = 8;
        this.swipeThreshold = 0.15;
        this.lastSwipeTime = 0;
        this.swipeCooldown = 600;

        // Grab / Drag
        this.isGrabbing = false;
        this.grabStartPos = null;

        // State
        this.currentGesture = 'idle';
        this.handPresent = false;
        this.cursorX = window.innerWidth / 2;
        this.cursorY = window.innerHeight / 2;
    }

    /**
     * Process a frame of hand landmarks
     * @param {Array} landmarks - 21 MediaPipe hand landmarks
     * @returns {Object} Action to perform
     */
    process(landmarks) {
        if (!landmarks || landmarks.length < 21) {
            this.handPresent = false;
            this.currentGesture = 'idle';
            return { action: 'none', handPresent: false };
        }

        this.handPresent = true;
        const fingerStates = this.getFingerStates(landmarks);
        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        const palmCenter = this.getPalmCenter(landmarks);

        // Update cursor position (smooth tracking of index fingertip)
        this.updateCursor(indexTip);

        // Track swipe motion
        this.trackSwipe(palmCenter);

        // Determine gesture & action
        const pinchDist = this.dist2D(thumbTip, indexTip);
        const isPinchNow = pinchDist < this.pinchThreshold;
        const extendedCount = [fingerStates.index, fingerStates.middle, fingerStates.ring, fingerStates.pinky].filter(Boolean).length;
        const allCurled = extendedCount === 0;
        const openPalm = extendedCount >= 4 && fingerStates.thumb;
        const pointingIndex = fingerStates.index && !fingerStates.middle && !fingerStates.ring && !fingerStates.pinky;

        let result = { action: 'none', handPresent: true, cursorX: this.cursorX, cursorY: this.cursorY, gesture: 'point' };

        // 1. AIR CLICK — pinch thumb + index
        if (isPinchNow && !this.isPinching) {
            this.isPinching = true;
            this.pinchStartTime = Date.now();
        } else if (!isPinchNow && this.isPinching) {
            this.isPinching = false;
            const now = Date.now();
            const holdDuration = now - this.pinchStartTime;
            if (holdDuration < 500 && now - this.lastClickTime > this.clickCooldown) {
                this.lastClickTime = now;
                this.currentGesture = 'click';
                result = { ...result, action: 'click', gesture: 'click' };
                return result;
            }
        }

        // 2. GRAB / DRAG — make fist
        if (allCurled && !fingerStates.thumb) {
            if (!this.isGrabbing) {
                this.isGrabbing = true;
                this.grabStartPos = { x: this.cursorX, y: this.cursorY };
                this.currentGesture = 'grab';
                result = { ...result, action: 'grab_start', gesture: 'grab' };
            } else {
                const dx = this.cursorX - this.grabStartPos.x;
                const dy = this.cursorY - this.grabStartPos.y;
                this.currentGesture = 'drag';
                result = {
                    ...result,
                    action: 'drag',
                    gesture: 'drag',
                    dragDeltaX: dx,
                    dragDeltaY: dy,
                    dragStartX: this.grabStartPos.x,
                    dragStartY: this.grabStartPos.y,
                };
            }
            return result;
        } else if (this.isGrabbing) {
            this.isGrabbing = false;
            this.currentGesture = 'point';
            result = { ...result, action: 'grab_end', gesture: 'point' };
            return result;
        }

        // 3. SCROLL — open palm moving vertically
        if (openPalm) {
            const currentY = palmCenter.y;
            if (!this.isScrolling) {
                this.isScrolling = true;
                this.scrollBaseY = currentY;
                this.lastScrollY = currentY;
                this.currentGesture = 'scroll';
            }
            const deltaY = (currentY - this.lastScrollY) * this.scrollSensitivity;
            this.lastScrollY = currentY;
            if (Math.abs(deltaY) > 0.3) {
                result = { ...result, action: 'scroll', gesture: 'scroll', scrollDelta: deltaY * 80 };
                return result;
            }
            result.gesture = 'scroll';
            return result;
        } else {
            this.isScrolling = false;
        }

        // 4. SWIPE — quick horizontal sweep
        const swipeResult = this.detectSwipe();
        if (swipeResult) {
            this.currentGesture = swipeResult;
            result = { ...result, action: 'swipe', gesture: swipeResult, direction: swipeResult };
            return result;
        }

        // 5. POINT — index finger up (default cursor mode)
        if (pointingIndex || (fingerStates.index && fingerStates.middle)) {
            this.currentGesture = 'point';
            result.gesture = 'point';
        }

        // 6. PINCH HOLD — for zoom or drag
        if (isPinchNow) {
            this.currentGesture = 'pinch';
            result.gesture = 'pinch';
        }

        return result;
    }

    // ─── Cursor ──────────────────────────────────────────────────

    updateCursor(indexTip) {
        // Map hand coordinates (0-1) to screen coordinates
        // with margins so you don't have to reach the edges
        const margin = 0.1;
        const mappedX = (indexTip.x - margin) / (1 - 2 * margin);
        const mappedY = (indexTip.y - margin) / (1 - 2 * margin);

        const targetX = (1 - mappedX) * window.innerWidth; // mirrored
        const targetY = mappedY * window.innerHeight;

        // Smooth
        this.smoothX = this.smoothX + (targetX - this.smoothX) * this.smoothingFactor;
        this.smoothY = this.smoothY + (targetY - this.smoothY) * this.smoothingFactor;

        this.cursorX = Math.max(0, Math.min(window.innerWidth, this.smoothX));
        this.cursorY = Math.max(0, Math.min(window.innerHeight, this.smoothY));
    }

    // ─── Swipe Detection ────────────────────────────────────────

    trackSwipe(palmCenter) {
        this.swipeBuffer.push({ x: palmCenter.x, y: palmCenter.y, t: Date.now() });
        if (this.swipeBuffer.length > this.swipeBufferSize) this.swipeBuffer.shift();
    }

    detectSwipe() {
        if (this.swipeBuffer.length < 5) return null;
        const now = Date.now();
        if (now - this.lastSwipeTime < this.swipeCooldown) return null;

        const recent = this.swipeBuffer.slice(-5);
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = last.t - first.t;
        if (dt > 400) return null; // too slow

        const dx = last.x - first.x;
        const dy = last.y - first.y;

        if (Math.abs(dx) > this.swipeThreshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
            this.lastSwipeTime = now;
            this.swipeBuffer = [];
            return dx > 0 ? 'swipe_left' : 'swipe_right'; // mirrored camera
        }

        if (Math.abs(dy) > this.swipeThreshold && Math.abs(dy) > Math.abs(dx) * 1.5) {
            this.lastSwipeTime = now;
            this.swipeBuffer = [];
            return dy > 0 ? 'swipe_down' : 'swipe_up';
        }

        return null;
    }

    // ─── Helpers ─────────────────────────────────────────────────

    getFingerStates(lm) {
        return {
            thumb: this.isThumbExtended(lm),
            index: this.isFingerExtended(lm, 5, 6, 7, 8),
            middle: this.isFingerExtended(lm, 9, 10, 11, 12),
            ring: this.isFingerExtended(lm, 13, 14, 15, 16),
            pinky: this.isFingerExtended(lm, 17, 18, 19, 20),
        };
    }

    isThumbExtended(lm) {
        const tipToIndex = this.dist2D(lm[4], lm[5]);
        const mcpToIndex = this.dist2D(lm[2], lm[5]);
        return tipToIndex > mcpToIndex * 0.85;
    }

    isFingerExtended(lm, mcp, pip, dip, tip) {
        const tipToWrist = this.dist2D(lm[tip], lm[0]);
        const pipToWrist = this.dist2D(lm[pip], lm[0]);
        const angle = this.angle3(lm[mcp], lm[pip], lm[tip]);
        return tipToWrist > pipToWrist * 0.85 && angle > 140;
    }

    getPalmCenter(lm) {
        const indices = [0, 5, 9, 13, 17];
        const avg = { x: 0, y: 0, z: 0 };
        for (const i of indices) {
            avg.x += lm[i].x;
            avg.y += lm[i].y;
            avg.z += lm[i].z || 0;
        }
        avg.x /= indices.length;
        avg.y /= indices.length;
        avg.z /= indices.length;
        return avg;
    }

    dist2D(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    angle3(a, b, c) {
        const v1 = { x: a.x - b.x, y: a.y - b.y };
        const v2 = { x: c.x - b.x, y: c.y - b.y };
        const dot = v1.x * v2.x + v1.y * v2.y;
        const m1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
        const m2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);
        if (m1 === 0 || m2 === 0) return 0;
        return Math.acos(Math.min(1, Math.max(-1, dot / (m1 * m2)))) * (180 / Math.PI);
    }
}

// GestureEngine is available globally via window.GestureEngine
