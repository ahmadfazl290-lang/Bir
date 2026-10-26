"""Extract an Anki package using Anki's native importer, without a live profile.

Run with the installed Anki Python runtime via run_apkg_extract.ps1. The result
contains plain text only; neither card HTML nor scripts are evaluated.
"""
from __future__ import annotations

import hashlib
import html
from html.parser import HTMLParser
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import sys
import traceback
from urllib.parse import unquote, urlsplit
import zipfile

MAX_PACKAGE_BYTES = 256 * 1024 * 1024
MAX_UNPACKED_BYTES = 768 * 1024 * 1024
MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 30000
MAX_CARDS = 100000
MAX_TEXT_CHARS = 200000
BLOCKED_TAGS = {"script", "style", "iframe", "object", "embed", "noscript", "svg"}
BLOCK_TAGS = {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "hr", "section"}
ANSWER_DIVIDER = re.compile(r'<hr\b[^>]*\bid\s*=\s*(?:"answer"|\'answer\'|answer)(?=\s|/?>)[^>]*>', re.I)
SAFE_IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"}
SAFE_AUDIO_MIMES = {"audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/flac"}


def safe_filename(value: str) -> bool:
    return bool(value and value not in {".", ".."} and not any(c in value for c in ("/", "\\", "\x00", ":")) and not any(ord(c) < 32 for c in value))


def media_reference(value: str) -> str | None:
    value = html.unescape(value).strip()
    if not value or value.startswith(("//", "/", "\\")):
        return None
    try:
        if urlsplit(value).scheme:
            return None
    except ValueError:
        return None
    value = unquote(value).split("?", 1)[0].split("#", 1)[0]
    return value if safe_filename(value) else None


class PlainCard(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.images = []
        self.suppressed = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in BLOCKED_TAGS:
            self.suppressed.append(tag)
            return
        if self.suppressed:
            return
        attrs = dict(attrs)
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "img":
            src = media_reference(attrs.get("src", ""))
            if src and src not in self.images:
                self.images.append(src)
            alt = attrs.get("alt", "").strip()
            if alt:
                self.parts.append(alt)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in BLOCKED_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.suppressed:
            if tag in self.suppressed:
                # Ignore all nested content until the matching blocked element.
                self.suppressed = self.suppressed[:self.suppressed.index(tag)]
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.suppressed:
            self.parts.append(data)

    def result(self):
        value = "".join(self.parts).replace("\xa0", " ")
        value = re.sub(r"\[sound:[^\]\r\n]+\]", "", value)
        value = re.sub(r"[ \t]+", " ", value)
        value = re.sub(r" *\n *", "\n", value)
        value = re.sub(r"\n{3,}", "\n\n", value).strip()
        if len(value) > MAX_TEXT_CHARS:
            raise ValueError("A card contains too much text to import safely.")
        return value


def plain(value):
    parser = PlainCard()
    parser.feed(str(value or ""))
    parser.close()
    return parser.result(), parser.images


def check_package(package: Path):
    if not package.is_file() or package.suffix.lower() != ".apkg":
        raise ValueError("Choose an .apkg Anki deck package.")
    if package.stat().st_size > MAX_PACKAGE_BYTES:
        raise ValueError("This Anki package is larger than the 256 MB import limit.")
    if not zipfile.is_zipfile(package):
        raise ValueError("The selected file is not a readable Anki package.")
    with zipfile.ZipFile(package) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES:
            raise ValueError("This package contains too many files.")
        total = 0
        names = set()
        for entry in entries:
            name = entry.filename.replace("\\", "/")
            path = PurePosixPath(name)
            if (name.startswith("/") or any(part in {"..", "."} for part in path.parts)
                    or ":" in name or "\x00" in name or name in names):
                raise ValueError("This package contains an unsafe archive path.")
            names.add(name)
            if entry.flag_bits & 1:
                raise ValueError("Encrypted Anki packages are not supported.")
            mode = entry.external_attr >> 16
            if (mode & 0o170000) == 0o120000:
                raise ValueError("This package contains an unsafe symbolic link.")
            total += entry.file_size
            if entry.file_size > MAX_ENTRY_BYTES or total > MAX_UNPACKED_BYTES:
                raise ValueError("This package expands beyond the import size limit.")
        if not any(name in names for name in ("collection.anki2", "collection.anki21", "collection.anki21b")):
            raise ValueError("No Anki collection was found in this package.")
        # Older packages use a JSON map: validate real filenames as well as ZIP
        # entry paths before the native importer writes any media.
        if "media" in names:
            raw = archive.read("media")
            try:
                media = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError):
                media = None  # Modern packages use Anki's protobuf media map.
            if media is not None:
                if not isinstance(media, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not safe_filename(v) for k, v in media.items()):
                    raise ValueError("This package contains an unsafe media filename.")


def extract(package: Path, output: Path):
    check_package(package)
    output.mkdir(parents=True, exist_ok=True)
    # A caller must allocate a fresh directory for each request. An existing
    # collection must never be reused, including after an interrupted request.
    collection_file = output / "collection.anki2"
    if collection_file.exists():
        raise ValueError("Use a new output directory for each Anki import.")
    from anki.collection import Collection
    from anki.import_export_pb2 import ImportAnkiPackageRequest, ImportAnkiPackageOptions
    collection = Collection(str(collection_file))
    try:
        collection.import_anki_package(ImportAnkiPackageRequest(
            package_path=str(package.resolve()),
            options=ImportAnkiPackageOptions(
                merge_notetypes=True, update_notes=1, update_notetypes=1,
                with_scheduling=False, with_deck_configs=False,
            ),
        ))
        collection._clear_caches()
        count = collection.card_count()
        if not count:
            raise ValueError("No flashcards were found in this package.")
        if count > MAX_CARDS:
            raise ValueError("This package contains more than 100,000 cards.")
        deck_ids = set(collection.db.list("select distinct did from cards"))
        decks = [{"sourceId": str(did), "name": collection.decks.name(did)} for did in sorted(deck_ids)]
        cards = []
        referenced = set()
        for cid in collection.db.list("select id from cards order by id"):
            card = collection.get_card(cid)
            note = card.note()
            fields = {name.casefold(): value for name, value in note.items()}
            q = card.question()
            answer = card.answer()
            answer_parts = ANSWER_DIVIDER.split(answer, maxsplit=1)
            front, front_images = plain(q)
            back, back_images = plain(answer_parts[-1])
            definition = ""
            image_caption = ""
            source = ""
            forms = ""
            # The supplied eight-field vocabulary deck has useful structured
            # values. Keep them separate, rather than parsing its visual layout.
            if all(key in fields for key in ("word", "meaning", "definition")) and card.ord == 0:
                front, front_images = plain(fields["word"])
                back, back_images = plain(fields["meaning"])
                definition = plain(fields["definition"])[0]
                _, extra_images = plain(fields.get("image", ""))
                back_images.extend(extra_images)
                image_caption = plain(fields.get("imagecaption", ""))[0]
                source = plain(fields.get("source", ""))[0]
                forms = plain(fields.get("forms", ""))[0]
            front_images = list(dict.fromkeys(front_images))
            # The reviewer keeps the question visible while revealing the
            # answer, so images repeated through {{FrontSide}} need not repeat.
            back_images = [name for name in dict.fromkeys(back_images) if name not in front_images]
            images = list(dict.fromkeys(front_images + back_images))
            referenced.update(images)
            cards.append({
                "sourceId": f"{note.guid}:{card.ord}", "guid": note.guid,
                "templateOrd": card.ord, "sourceDeck": str(card.did),
                "front": front, "back": back, "definition": definition,
                "image": images[0] if images else None, "images": images,
                "frontImages": front_images, "backImages": back_images,
                "imageCaption": image_caption, "source": source, "forms": forms,
                "tags": list(note.tags),
            })
        if len({card["sourceId"] for card in cards}) != len(cards):
            raise ValueError("This package contains ambiguous card identifiers.")
        media = []
        media_root = Path(collection.media.dir()).resolve()
        media_bytes = 0
        available = set()
        for path in sorted(media_root.iterdir()):
            if not path.is_file() or not safe_filename(path.name) or path.resolve().parent != media_root:
                continue
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if mime not in SAFE_IMAGE_MIMES | SAFE_AUDIO_MIMES:
                continue
            media_bytes += path.stat().st_size
            if media_bytes > MAX_UNPACKED_BYTES:
                raise ValueError("The imported media exceeds the size limit.")
            media.append({"filename": path.name, "file": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "mime": mime})
            available.add(path.name)
        missing = sorted(referenced - available)
        audio_count = sum(item["mime"] in SAFE_AUDIO_MIMES for item in media)
        warnings = []
        warning_codes = []
        if missing:
            warnings.append(f"{len(missing)} referenced images were missing or unsupported (including SVG).")
            warning_codes.append("missing_or_unsupported_images")
        if audio_count:
            warnings.append(f"{audio_count} audio files were extracted; audio playback is not yet supported in this preview.")
            warning_codes.append("audio_playback_unsupported")
        return {
            "schemaVersion": 1, "sourceFormat": "apkg", "sourceName": package.name,
            "decks": decks, "cards": cards, "media": media,
            "warnings": warnings, "warningCodes": warning_codes,
            "counts": {"notes": collection.note_count(), "cards": len(cards), "media": len(media), "missingImages": len(missing)},
            "schedulingImported": False,
        }
    finally:
        collection.close()


def main():
    package = Path(os.environ["BIR_APKG_PACKAGE"])
    output = Path(os.environ["BIR_APKG_OUTPUT"])
    result_path = Path(os.environ["BIR_APKG_RESULT"])
    try:
        result = extract(package, output)
        result["ok"] = True
    except Exception as error:
        result = {"ok": False, "error": str(error), "errorType": type(error).__name__}
        # Detailed diagnostics stay local, separate from user facing errors.
        output.mkdir(parents=True, exist_ok=True)
        (output / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
    result_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = result_path.with_suffix(result_path.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    temporary.replace(result_path)


if __name__ == "__main__":
    main()
