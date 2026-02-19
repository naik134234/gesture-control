import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from huggingface_hub import HfApi

TOKEN = os.environ.get("HF_TOKEN", input("Enter HF token: ").strip())
api = HfApi(token=TOKEN)

print("Starting upload...", flush=True)

# Delete wrong style.css from both spaces
for space in ["naik123/gesture-control", "naik123/sign-language-reader"]:
    try:
        api.delete_file("style.css", repo_id=space, repo_type="space")
        print(f"Deleted style.css from {space}", flush=True)
    except Exception as e:
        print(f"Delete note ({space}): {e}", flush=True)

# Upload gesture-control files
gc_src = r"C:\Users\chand\.gemini\antigravity\scratch\gesture-control"
for f in ["index.html", "styles.css", "app.js", "gesture-engine.js"]:
    fpath = os.path.join(gc_src, f)
    if not os.path.exists(fpath):
        print(f"MISSING: {fpath}", flush=True)
        continue
    print(f"Uploading {f} -> gesture-control ...", flush=True)
    try:
        api.upload_file(
            path_or_fileobj=fpath,
            path_in_repo=f,
            repo_id="naik123/gesture-control",
            repo_type="space",
        )
        print(f"  OK: {f}", flush=True)
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)

# Upload sign-language-reader files
sl_src = r"C:\Users\chand\.gemini\antigravity\scratch\sign-language-reader"
for f in ["index.html", "styles.css", "app.js", "gesture-classifier.js", "words.js"]:
    fpath = os.path.join(sl_src, f)
    if not os.path.exists(fpath):
        print(f"MISSING: {fpath}", flush=True)
        continue
    print(f"Uploading {f} -> sign-language-reader ...", flush=True)
    try:
        api.upload_file(
            path_or_fileobj=fpath,
            path_in_repo=f,
            repo_id="naik123/sign-language-reader",
            repo_type="space",
        )
        print(f"  OK: {f}", flush=True)
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)

# Verify
print("\nVerifying uploads...", flush=True)
for space in ["naik123/gesture-control", "naik123/sign-language-reader"]:
    files = api.list_repo_files(space, repo_type="space")
    print(f"{space}: {files}", flush=True)

print("\nDONE!", flush=True)
