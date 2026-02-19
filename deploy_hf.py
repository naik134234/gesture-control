# -*- coding: utf-8 -*-
"""Deploy both projects to Hugging Face Spaces as static HTML."""
import os
import shutil
import tempfile
import sys

# Force utf-8
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HF_TOKEN = os.environ.get("HF_TOKEN", "")
if not HF_TOKEN:
    HF_TOKEN = input("Enter your Hugging Face token: ").strip()

from huggingface_hub import HfApi, create_repo

api = HfApi(token=HF_TOKEN)
whoami = api.whoami()
USERNAME = whoami["name"]
print(f"Logged in as: {USERNAME}")

SPACES = [
    {
        "name": "gesture-control",
        "title": "GestureControl - Touchless Screen Control",
        "src": r"C:\Users\chand\.gemini\antigravity\scratch\gesture-control",
        "files": ["index.html", "styles.css", "app.js", "gesture-engine.js"],
    },
    {
        "name": "sign-language-reader",
        "title": "SignSpeak - ASL Sign Language Recognition",
        "src": r"C:\Users\chand\.gemini\antigravity\scratch\sign-language-reader",
        "files": ["index.html", "styles.css", "app.js", "gesture-classifier.js", "words.js"],
    },
]

for space in SPACES:
    space_id = f"{USERNAME}/{space['name']}"
    print(f"\n{'='*50}")
    print(f"Deploying: {space_id}")
    print(f"{'='*50}")

    tmp = os.path.join(tempfile.gettempdir(), f"hf-{space['name']}")
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    os.makedirs(tmp)

    # HF Space metadata README (ASCII-safe)
    readme_content = (
        "---\n"
        f"title: {space['title']}\n"
        "emoji: hand\n"
        "colorFrom: purple\n"
        "colorTo: cyan\n"
        "sdk: static\n"
        "pinned: false\n"
        "license: mit\n"
        "---\n"
    )
    with open(os.path.join(tmp, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme_content)

    for fname in space["files"]:
        src = os.path.join(space["src"], fname)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(tmp, fname))
            print(f"  + {fname}")

    try:
        create_repo(repo_id=space_id, repo_type="space", space_sdk="static",
                    exist_ok=True, private=False, token=HF_TOKEN)
        print(f"  Space ready: {space_id}")
    except Exception as e:
        print(f"  create_repo note: {e}")

    try:
        api.upload_folder(folder_path=tmp, repo_id=space_id, repo_type="space", token=HF_TOKEN)
        print(f"  DEPLOYED: https://huggingface.co/spaces/{space_id}")
    except Exception as e:
        print(f"  Upload error: {e}")

    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{'='*50}")
print("All done!")
print(f"  https://huggingface.co/spaces/{USERNAME}/gesture-control")
print(f"  https://huggingface.co/spaces/{USERNAME}/sign-language-reader")
