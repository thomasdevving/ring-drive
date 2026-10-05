"""Package only non-ignored source and the explicit simulator build, never local credentials."""
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
output = root.parent / "RingDrive-Demo.zip"
files = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root).decode().split("\0")
blocked_parts = {".git", ".build", "DerivedData", "node_modules", "xcuserdata", ".secrets"}
def safe(path):
    name = path.name
    return not (blocked_parts.intersection(path.parts) or name in {".env", ".DS_Store"} or (name.startswith(".env.") and name != ".env.example") or
                name.endswith((".local.enc", ".local.enc.tmp", ".local.json", ".log", ".pem", ".key", ".p12")))
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for relative in sorted(set(files)):
        path = root / relative
        if relative and path.is_file() and safe(Path(relative)):
            archive.write(path, "RingDrive/" + relative)
    build = root / "Build" / "RingDrive.app"
    for path in sorted(build.rglob("*")):
        if path.is_file() and safe(path.relative_to(root)):
            archive.write(path, "RingDrive/" + str(path.relative_to(root)))
with zipfile.ZipFile(output) as archive:
    assert all(safe(Path(name)) for name in archive.namelist())
    print(f"Packaged {len(archive.namelist())} files; local configuration and token storage excluded.")
