# GestureControl — Touchless Screen Control

Control your PC with hand gestures. No touch. No mouse. Just your hand.

## 🎯 Two Versions

### 1. Desktop Controller (Python) — Controls Your REAL Mouse
Uses your webcam + MediaPipe to control the actual mouse cursor across your entire screen.

```bash
pip install -r requirements.txt
python desktop_control.py
```

**Gestures:**
| Gesture | How | Action |
|---------|-----|--------|
| ☝️ Point | Index finger up | Move cursor |
| 🤏 Pinch | Thumb + index touch | Left Click |
| 🤏🤏 Double-pinch | Quick twice | Double Click |
| ✌️ Peace + pinch | Two fingers up, pinch | Right Click |
| 🖐️ Open palm | All fingers, move up/down | Scroll |
| ✊ Fist | Close hand | Drag & Drop |

**Controls:** `Q`=Quit `P`=Pause `+`/`-`=Sensitivity

### 2. Web Demo (HTML/JS) — In-Browser Interactive Demo
A beautiful web UI showcasing gesture control with interactive widgets.

```bash
npx serve . -l 3001
# Open http://localhost:3001
```

**Pages:**
- **Widgets** — Counter, color picker, toggles, music player, sliders
- **Gallery** — Draggable cards (grab with fist gesture)
- **Tech Info** — Architecture details

## 🛠 Tech Stack
- **MediaPipe Hands** — Real-time 21-point hand tracking
- **PyAutoGUI** — Desktop mouse control (Python version)
- **OpenCV** — Webcam capture & display (Python version)
- **Canvas API** — Cursor rendering (Web version)

## 🧠 Accuracy Features (v2)
- Adaptive EMA smoothing (velocity-aware)
- Dead-zone jitter suppression
- Pinch hysteresis (separate open/close thresholds)
- Gesture confirmation (multi-frame stability)
- PIP angle-based finger detection
- Hand-loss timeout (3-frame grace period)

## 📁 Files
```
desktop_control.py   — Python desktop controller (main app)
gesture-engine.js    — Web gesture engine
app.js               — Web app logic
styles.css           — Web UI theme
index.html           — Web UI structure
requirements.txt     — Python dependencies
```

## License
MIT
