"""Verify, extract or rebuild lossless transports without changing model identities or placements."""
from pathlib import Path
import argparse
import gzip
import hashlib
import io
import json

ROOT = Path(__file__).resolve().parents[1] / "assets/field-models/v1"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--manifest", type=Path, default=ROOT / "manifest-r3.json")
parser.add_argument("--output", type=Path, help="Defaults to the input manifest; use a new URL for a release.")
sources = parser.add_mutually_exclusive_group()
sources.add_argument("--originals", type=Path, help="Read original models/<ID>.glb files from this directory.")
sources.add_argument("--extract-to", type=Path, help="Restore original models/<ID>.glb files here; do not rewrite transports.")
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text())
directory = args.manifest.resolve().parent
if args.extract_to and args.output:
    parser.error("--output cannot be combined with --extract-to")


def safe_path(root, relative):
    root = root.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Model path leaves its directory")
    return path


def verified_original(asset):
    if args.originals:
        original = safe_path(args.originals, asset["file"]).read_bytes()
    else:
        transport = asset["transport"]
        if transport["compression"] != "gzip":
            raise ValueError("Unsupported model transport")
        encoded = safe_path(directory, transport["file"]).read_bytes()
        if len(encoded) != transport["bytes"] or hashlib.sha256(encoded).hexdigest() != transport["sha256"]:
            raise ValueError(f"Transport identity mismatch: {asset['id']}")
        # Bound decoding and force CRC/size validation when the expected stream ends.
        with gzip.GzipFile(fileobj=io.BytesIO(encoded)) as stream:
            original = stream.read(asset["bytes"] + 1)
    if len(original) != asset["bytes"] or hashlib.sha256(original).hexdigest() != asset["sha256"]:
        raise ValueError(f"Original model identity mismatch: {asset['id']}")
    return original


original_total = compressed_total = 0
for asset in manifest["assets"]:
    original = verified_original(asset)
    original_total += len(original)
    if args.extract_to:
        target = safe_path(args.extract_to, asset["file"])
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != original:
            raise ValueError(f"Refusing to overwrite different local model: {target}")
        target.write_bytes(original)
        compressed_total += asset["transport"]["bytes"]
        continue
    compressed = gzip.compress(original, compresslevel=9, mtime=0)
    if gzip.decompress(compressed) != original:
        raise ValueError(f"Compression changed model bytes: {asset['id']}")
    name = Path(asset["file"]).stem
    if not name or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in name):
        raise ValueError("Unsupported model filename")
    transport_path = f"compressed/{name}.glb.gz"
    target = directory / transport_path
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(compressed)
    asset["transport"] = {"file": transport_path, "compression": "gzip", "bytes": len(compressed),
                          "sha256": hashlib.sha256(compressed).hexdigest()}
    compressed_total += len(compressed)
if not args.extract_to:
    (args.output or args.manifest).write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"models": len(manifest["assets"]), "originalBytes": original_total,
                  "compressedBytes": compressed_total}))
