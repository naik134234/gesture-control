"""
GestureControl Desktop — Touchless PC Control (v2 — High Accuracy)
Controls your REAL mouse cursor across the entire screen using hand gestures.

Accuracy improvements over v1:
  ✦ Adaptive EMA smoothing with velocity-based factor
  ✦ Dead-zone jitter suppression (cursor stays still if hand barely moves)
  ✦ Pinch hysteresis (separate open/close thresholds to prevent flicker)
  ✦ Gesture confirmation (must hold gesture for N frames before triggering)
  ✦ Better finger detection using PIP angle checks
  ✦ Palm stability filter for scroll mode

Gestures:
  ☝️  Point (index finger)     → Move cursor
  🤏 Pinch (thumb + index)     → Left Click
  ✌️  Peace + pinch thumb      → Right Click
  🖐️ Open palm + move up/down → Scroll
  ✊  Fist                      → Drag (hold & move)
  ☝️+🖕 Index + middle up      → Double Click (pinch both)

Press 'Q' to quit | 'P' to pause/resume | '+'/'-' to adjust sensitivity
"""

import cv2
import mediapipe as mp
import pyautogui
import numpy as np
import time
import math
import sys
import collections

# ─── Safety ──────────────────────────────────────────────────────────
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0
pyautogui.MINIMUM_DURATION = 0

# ─── Screen ──────────────────────────────────────────────────────────
SCREEN_W, SCREEN_H = pyautogui.size()

# ─── Tunable Parameters ─────────────────────────────────────────────
class Config:
    # Camera
    CAM_W = 640
    CAM_H = 480

    # Cursor smoothing
    SMOOTH_BASE = 0.25        # Base smoothing (0.1=very smooth, 0.5=fast)
    SMOOTH_FAST = 0.55        # Smoothing when hand moves fast
    VELOCITY_THRESHOLD = 40   # px/frame — switch to fast smoothing above this

    # Dead-zone: ignore movements smaller than this (pixels)
    DEAD_ZONE = 3

    # Mapping margins (how far from edge of camera you need to be)
    MARGIN = 0.10

    # Pinch detection — hysteresis
    PINCH_CLOSE = 0.045       # Distance to START pinch
    PINCH_OPEN = 0.065        # Distance to END pinch (wider = less flicker)

    # Timing
    CLICK_COOLDOWN = 0.35
    DOUBLE_CLICK_WINDOW = 0.35
    SCROLL_SENSITIVITY = 50

    # Gesture confirmation (frames the gesture must be stable)
    CONFIRM_FRAMES = 2        # Frames before acting on a new gesture
    FIST_CONFIRM = 3          # Fist needs more confirmation (avoid false drags)


# ─── MediaPipe ───────────────────────────────────────────────────────
mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
mp_styles = mp.solutions.drawing_styles


class GestureDesktopController:
    """High-accuracy gesture → mouse controller."""

    def __init__(self):
        self.cfg = Config()

        # Cursor smoothing
        self.smooth_x = SCREEN_W / 2
        self.smooth_y = SCREEN_H / 2
        self.prev_target_x = SCREEN_W / 2
        self.prev_target_y = SCREEN_H / 2

        # Click state
        self.is_pinching = False
        self.pinch_start_time = 0
        self.last_click_time = 0
        self.last_right_click_time = 0
        self.click_count = 0
        self.last_single_click_time = 0

        # Scroll
        self.is_scrolling = False
        self.scroll_origin_y = 0
        self.last_scroll_y = 0
        self.scroll_frames = 0

        # Drag
        self.is_dragging = False

        # Gesture confirmation
        self.gesture_history = collections.deque(maxlen=8)
        self.current_confirmed_gesture = 'idle'
        self.gesture_frame_count = 0

        # Hand loss timeout
        self.last_hand_time = 0
        self.hand_lost_frames = 0

        # Display
        self.gesture_text = "Idle"
        self.paused = False

        # Stats
        self.total_clicks = 0
        self.total_scrolls = 0

    # ─── Finger detection (improved with angle) ───────────────────
    def _angle(self, a, b, c):
        """Angle at point b between segments ba and bc (degrees)."""
        v1 = np.array([a.x - b.x, a.y - b.y])
        v2 = np.array([c.x - b.x, c.y - b.y])
        cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
        return np.degrees(np.arccos(np.clip(cos, -1, 1)))

    def _dist(self, a, b):
        return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)

    def _is_finger_extended(self, lm, mcp, pip, dip, tip):
        """Check finger extension using distance + PIP angle."""
        tip_w = self._dist(lm[tip], lm[0])
        pip_w = self._dist(lm[pip], lm[0])
        angle = self._angle(lm[mcp], lm[pip], lm[tip])
        return tip_w > pip_w * 0.82 and angle > 140

    def _is_thumb_extended(self, lm):
        tip_to_index = self._dist(lm[4], lm[5])
        mcp_to_index = self._dist(lm[2], lm[5])
        return tip_to_index > mcp_to_index * 0.78

    def _get_fingers(self, lm):
        return {
            'thumb':  self._is_thumb_extended(lm),
            'index':  self._is_finger_extended(lm, 5, 6, 7, 8),
            'middle': self._is_finger_extended(lm, 9, 10, 11, 12),
            'ring':   self._is_finger_extended(lm, 13, 14, 15, 16),
            'pinky':  self._is_finger_extended(lm, 17, 18, 19, 20),
        }

    # ─── Cursor mapping ──────────────────────────────────────────
    def _map_to_screen(self, x, y):
        m = self.cfg.MARGIN
        mx = (x - m) / (1 - 2 * m)
        my = (y - m) / (1 - 2 * m)
        sx = (1 - mx) * SCREEN_W  # mirrored
        sy = my * SCREEN_H
        return max(0, min(SCREEN_W - 1, sx)), max(0, min(SCREEN_H - 1, sy))

    def _smooth_move(self, tx, ty):
        """Adaptive EMA with velocity-based smoothing factor + dead-zone."""
        # Calculate velocity
        vx = abs(tx - self.prev_target_x)
        vy = abs(ty - self.prev_target_y)
        velocity = math.sqrt(vx**2 + vy**2)

        # Adaptive smoothing: fast hand → responsive, slow hand → smooth
        if velocity > self.cfg.VELOCITY_THRESHOLD:
            alpha = self.cfg.SMOOTH_FAST
        else:
            alpha = self.cfg.SMOOTH_BASE

        self.prev_target_x = tx
        self.prev_target_y = ty

        # Apply EMA
        new_x = self.smooth_x + (tx - self.smooth_x) * alpha
        new_y = self.smooth_y + (ty - self.smooth_y) * alpha

        # Dead-zone: don't update if movement is tiny (jitter suppression)
        dx = abs(new_x - self.smooth_x)
        dy = abs(new_y - self.smooth_y)
        if dx < self.cfg.DEAD_ZONE and dy < self.cfg.DEAD_ZONE:
            return int(self.smooth_x), int(self.smooth_y)

        self.smooth_x = new_x
        self.smooth_y = new_y
        return int(self.smooth_x), int(self.smooth_y)

    # ─── Gesture confirmation ────────────────────────────────────
    def _confirm_gesture(self, gesture):
        """Only act on a gesture if it's been stable for N frames."""
        self.gesture_history.append(gesture)

        if gesture == self.current_confirmed_gesture:
            self.gesture_frame_count += 1
            return True

        # New gesture — require confirmation
        needed = self.cfg.FIST_CONFIRM if gesture == 'fist' else self.cfg.CONFIRM_FRAMES
        recent = list(self.gesture_history)[-needed:]
        if len(recent) >= needed and all(g == gesture for g in recent):
            self.current_confirmed_gesture = gesture
            self.gesture_frame_count = needed
            return True

        return False

    # ─── Main processing ─────────────────────────────────────────
    def process(self, landmarks):
        lm = landmarks.landmark
        fingers = self._get_fingers(lm)
        now = time.time()

        index_tip = lm[8]
        thumb_tip = lm[4]

        extended = sum([fingers['index'], fingers['middle'],
                       fingers['ring'], fingers['pinky']])
        all_curled = extended == 0 and not fingers['thumb']
        open_palm = extended >= 4 and fingers['thumb']
        pointing = fingers['index'] and not fingers['middle'] and not fingers['ring'] and not fingers['pinky']
        peace = fingers['index'] and fingers['middle'] and not fingers['ring'] and not fingers['pinky']

        pinch_dist = self._dist(thumb_tip, index_tip)

        # ─── CURSOR MOVEMENT (always) ───────────────────────────
        tx, ty = self._map_to_screen(index_tip.x, index_tip.y)
        sx, sy = self._smooth_move(tx, ty)
        pyautogui.moveTo(sx, sy, _pause=False)

        # ─── PINCH with hysteresis ──────────────────────────────
        if not self.is_pinching and pinch_dist < self.cfg.PINCH_CLOSE:
            self.is_pinching = True
            self.pinch_start_time = now
        elif self.is_pinching and pinch_dist > self.cfg.PINCH_OPEN:
            self.is_pinching = False
            hold = now - self.pinch_start_time
            if hold < 0.45 and now - self.last_click_time > self.cfg.CLICK_COOLDOWN:
                self.last_click_time = now

                if self.is_dragging:
                    pyautogui.mouseUp(_pause=False)
                    self.is_dragging = False
                    self.gesture_text = "✋ Released"
                    return
                elif peace:
                    # Peace sign + pinch = right-click
                    if now - self.last_right_click_time > self.cfg.CLICK_COOLDOWN:
                        self.last_right_click_time = now
                        pyautogui.rightClick(_pause=False)
                        self.gesture_text = "🖱️ Right Click!"
                        self.total_clicks += 1
                        return
                else:
                    # Check for double-click
                    if now - self.last_single_click_time < self.cfg.DOUBLE_CLICK_WINDOW:
                        pyautogui.doubleClick(_pause=False)
                        self.gesture_text = "⏩ Double Click!"
                        self.last_single_click_time = 0
                    else:
                        pyautogui.click(_pause=False)
                        self.gesture_text = "👆 Click!"
                        self.last_single_click_time = now
                    self.total_clicks += 1
                    return

        # ─── FIST = DRAG (with confirmation) ────────────────────
        if all_curled:
            if self._confirm_gesture('fist'):
                if not self.is_dragging:
                    self.is_dragging = True
                    pyautogui.mouseDown(_pause=False)
                    self.gesture_text = "✊ Dragging..."
                else:
                    self.gesture_text = "✊ Dragging..."
                return
        elif self.is_dragging:
            self.is_dragging = False
            pyautogui.mouseUp(_pause=False)
            self.gesture_text = "✋ Released"
            return

        # ─── OPEN PALM = SCROLL (with stability) ────────────────
        if open_palm:
            palm_y = sum(lm[i].y for i in [0, 5, 9, 13, 17]) / 5

            if not self.is_scrolling:
                self.is_scrolling = True
                self.scroll_origin_y = palm_y
                self.last_scroll_y = palm_y
                self.scroll_frames = 0
                self.gesture_text = "🖐️ Scroll Ready"
            else:
                self.scroll_frames += 1
                # Wait 3 frames before scrolling to confirm intent
                if self.scroll_frames >= 3:
                    delta = (palm_y - self.last_scroll_y) * self.cfg.SCROLL_SENSITIVITY
                    self.last_scroll_y = palm_y
                    if abs(delta) > 0.2:
                        scroll_amount = int(-delta * 5)
                        scroll_amount = max(-15, min(15, scroll_amount))  # clamp
                        pyautogui.scroll(scroll_amount, _pause=False)
                        direction = 'Down ↓' if delta > 0 else 'Up ↑'
                        self.gesture_text = f"🖐️ Scroll {direction}"
                        self.total_scrolls += 1
            self._confirm_gesture('scroll')
            return
        else:
            self.is_scrolling = False
            self.scroll_frames = 0

        # ─── DEFAULT: POINTING ──────────────────────────────────
        if pointing:
            self._confirm_gesture('point')
            self.gesture_text = "☝️ Pointing"
        elif self.is_pinching:
            self._confirm_gesture('pinch')
            self.gesture_text = "🤏 Pinch Hold"
        elif peace:
            self._confirm_gesture('peace')
            self.gesture_text = "✌️ Peace"
        else:
            self._confirm_gesture('idle')
            self.gesture_text = "✋ Idle"

    def on_hand_lost(self):
        """Called when hand disappears from frame."""
        if self.is_dragging:
            pyautogui.mouseUp(_pause=False)
            self.is_dragging = False
        self.is_scrolling = False
        self.is_pinching = False
        self.scroll_frames = 0
        self.gesture_text = "No hand"
        self.current_confirmed_gesture = 'idle'
        self.gesture_history.clear()


def draw_hud(frame, ctrl, fps, hand_detected):
    """Draw heads-up display overlay on webcam preview."""
    h, w = frame.shape[:2]

    # Top bar
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 72), (10, 10, 30), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    cv2.putText(frame, "GestureControl Desktop v2", (12, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 245, 212), 2)

    status_color = (0, 230, 118) if hand_detected else (100, 100, 200)
    status = ctrl.gesture_text if hand_detected else "No hand detected"
    cv2.putText(frame, status, (12, 48),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, status_color, 1)

    # Stats
    stats = f"Clicks: {ctrl.total_clicks}  Scrolls: {ctrl.total_scrolls}"
    cv2.putText(frame, stats, (12, 65),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (136, 136, 170), 1)

    # FPS badge
    fps_color = (0, 230, 118) if fps >= 20 else (0, 200, 255) if fps >= 10 else (0, 0, 255)
    cv2.putText(frame, f"{fps} FPS", (w - 80, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, fps_color, 1)

    # Screen position indicator
    cx = int(ctrl.smooth_x / SCREEN_W * 100)
    cy = int(ctrl.smooth_y / SCREEN_H * 100)
    cv2.putText(frame, f"({cx}%, {cy}%)", (w - 100, 48),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (136, 136, 170), 1)

    # Pause overlay
    if ctrl.paused:
        cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 80), -1)
        cv2.addWeighted(overlay, 0.4, frame, 0.6, 0, frame)
        cv2.putText(frame, "PAUSED", (w // 2 - 70, h // 2 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (100, 180, 255), 3)
        cv2.putText(frame, "Press P to resume", (w // 2 - 85, h // 2 + 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 200), 1)

    # Bottom bar
    cv2.rectangle(overlay, (0, h - 28), (w, h), (10, 10, 30), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.putText(frame, "Q=Quit  P=Pause  Point=Move  Pinch=Click  Palm=Scroll  Fist=Drag  +/-=Sensitivity",
                (6, h - 9), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (100, 100, 140), 1)

    return frame


def main():
    print("=" * 64)
    print("  GestureControl Desktop v2 — Touchless PC Control")
    print("  High-Accuracy Edition")
    print("=" * 64)
    print(f"  Screen : {SCREEN_W} x {SCREEN_H}")
    print(f"  Camera : {Config.CAM_W} x {Config.CAM_H}")
    print()
    print("  Gestures:")
    print("    ☝️  Point (index finger)       → Move cursor")
    print("    🤏 Pinch (thumb + index)       → Left Click")
    print("    🤏🤏 Quick double-pinch         → Double Click")
    print("    ✌️  Peace sign + pinch thumb    → Right Click")
    print("    🖐️ Open palm, move up/down     → Scroll")
    print("    ✊  Fist                        → Drag / Hold")
    print()
    print("  Controls: Q=Quit  P=Pause  +/-=Sensitivity")
    print("  Emergency stop: move mouse to top-left corner")
    print("=" * 64)

    ctrl = GestureDesktopController()

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, Config.CAM_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, Config.CAM_H)
    cap.set(cv2.CAP_PROP_FPS, 30)

    if not cap.isOpened():
        print("[ERROR] Cannot open camera!")
        sys.exit(1)

    print("[OK] Camera opened. Gesture tracking active.\n")

    frame_count = 0
    fps_time = time.time()
    fps = 0
    no_hand_frames = 0

    with mp_hands.Hands(
        max_num_hands=1,
        model_complexity=1,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.65,
    ) as hands:

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)

            # FPS
            frame_count += 1
            if time.time() - fps_time >= 1.0:
                fps = frame_count
                frame_count = 0
                fps_time = time.time()

            hand_detected = False

            if not ctrl.paused:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False
                results = hands.process(rgb)

                if results.multi_hand_landmarks:
                    hand_detected = True
                    no_hand_frames = 0
                    hand_lm = results.multi_hand_landmarks[0]

                    mp_draw.draw_landmarks(
                        frame, hand_lm, mp_hands.HAND_CONNECTIONS,
                        mp_styles.get_default_hand_landmarks_style(),
                        mp_styles.get_default_hand_connections_style(),
                    )

                    ctrl.process(hand_lm)
                else:
                    no_hand_frames += 1
                    if no_hand_frames >= 3:  # Wait 3 frames before declaring hand lost
                        ctrl.on_hand_lost()

            frame = draw_hud(frame, ctrl, fps, hand_detected)
            cv2.imshow("GestureControl Desktop v2", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == ord('Q'):
                break
            elif key == ord('p') or key == ord('P'):
                ctrl.paused = not ctrl.paused
                if ctrl.paused:
                    ctrl.on_hand_lost()
                    print("[PAUSED]")
                else:
                    print("[RESUMED]")
            elif key == ord('+') or key == ord('='):
                ctrl.cfg.SMOOTH_BASE = min(0.6, ctrl.cfg.SMOOTH_BASE + 0.05)
                print(f"[SENSITIVITY] Smoothing: {ctrl.cfg.SMOOTH_BASE:.2f} (faster)")
            elif key == ord('-') or key == ord('_'):
                ctrl.cfg.SMOOTH_BASE = max(0.1, ctrl.cfg.SMOOTH_BASE - 0.05)
                print(f"[SENSITIVITY] Smoothing: {ctrl.cfg.SMOOTH_BASE:.2f} (smoother)")

    ctrl.on_hand_lost()
    cap.release()
    cv2.destroyAllWindows()
    print(f"\n[DONE] Session stats: {ctrl.total_clicks} clicks, {ctrl.total_scrolls} scrolls")


if __name__ == "__main__":
    main()
