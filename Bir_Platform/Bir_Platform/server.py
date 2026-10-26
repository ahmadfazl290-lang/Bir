"""Local preview server. APKG files are processed only on this PC."""
import argparse
import hashlib
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import urllib.parse

APP = pathlib.Path(__file__).resolve().parent
WORKSPACE = APP.parent
MEDIA = APP / 'media'
MEDIA.mkdir(parents=True, exist_ok=True)
WORK = APP / '.bir-data' / 'requests'
WORK.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD = 150 * 1024 * 1024
IMPORT_LOCK = threading.Lock()
MEDIA_LOCK = threading.Lock()
MEDIA_CACHE = None

def media_index():
    global MEDIA_CACHE
    if MEDIA_CACHE is None:
        MEDIA_CACHE = {}
        for path in MEDIA.iterdir():
            if path.is_file() and path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'}:
                MEDIA_CACHE[hashlib.sha256(path.read_bytes()).hexdigest()] = path.name
    return MEDIA_CACHE

def import_package(path, directory):
    helper = APP / 'server' / 'run_apkg_extract.ps1'
    if not helper.is_file():
        raise RuntimeError('APKG_HELPER_UNAVAILABLE')
    result_path = directory / 'result.json'
    executable = shutil.which('pwsh.exe') or shutil.which('pwsh') or shutil.which('powershell.exe')
    if not executable:
        raise RuntimeError('APKG_RUNTIME_UNAVAILABLE')
    command = [executable, '-NoProfile', '-File', str(helper), '-PackagePath', str(path), '-OutputDirectory', str(directory / 'extracted'), '-ResultPath', str(result_path)]
    run = subprocess.run(command, cwd=WORKSPACE, capture_output=True, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    (directory / 'runtime.log').write_bytes(run.stdout + run.stderr)
    if not result_path.is_file():
        raise RuntimeError('APKG_EXTRACTION_FAILED')
    result = json.loads(result_path.read_text(encoding='utf-8-sig'))
    if not result.get('ok'):
        raise RuntimeError(str(result.get('error', 'APKG_EXTRACTION_FAILED'))[:240])
    if len(result.get('cards', [])) > 100000:
        raise RuntimeError('TOO_MANY_ROWS')
    names = {}
    imported_media = 0
    unsupported_media = 0
    allowed = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/avif':'.avif'}
    extraction_root = (directory / 'extracted').resolve()
    with MEDIA_LOCK:
        known = media_index()
        for media in result.get('media', []):
            suffix = allowed.get(media.get('mime'))
            if not suffix:
                unsupported_media += 1
                continue
            file = pathlib.Path(media['file']).resolve()
            if not file.is_relative_to(extraction_root) or not file.is_file():
                raise RuntimeError('INVALID_MEDIA_PATH')
            data = file.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if digest != media['sha256']:
                raise RuntimeError('MEDIA_CHECK_FAILED')
            filename = known.get(digest)
            if filename is None:
                filename = 'import_' + digest + suffix
                destination = APP / 'media' / filename
                if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                    raise RuntimeError('MEDIA_COLLISION')
                if not destination.exists():
                    destination.write_bytes(data)
                known[digest] = filename
                imported_media += 1
            names[media['filename']] = filename
    cards = []
    for item in result.get('cards', []):
        original_images = item.get('backImages', item.get('images', [item.get('image', '')]))
        front_images = [names[name] for name in item.get('frontImages', []) if name in names]
        back_images = [names[name] for name in original_images if name in names and names[name] not in front_images]
        image = names.get(item.get('image', ''), '')
        cards.append({'sourceKey':'anki:' + item['sourceId'], 'guid':item['guid'], 'templateOrd':item['templateOrd'], 'sourceDeck':str(item['sourceDeck']), 'front':item.get('front', ''), 'back':item.get('back', ''), 'definition':item.get('definition', ''), 'image':image if not back_images and not front_images else '', 'frontImages':list(dict.fromkeys(front_images)), 'backImages':list(dict.fromkeys(back_images)), 'imageCaption':item.get('imageCaption', ''), 'tags':item.get('tags', [])})
    return {'ok':True,'decks':result.get('decks', []),'cards':cards,'counts':{'cards':len(cards),'media':len(names),'newMedia':imported_media,'unsupportedMedia':unsupported_media},'warnings':result.get('warnings', [])}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)
    def log_message(self, *args):
        pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()
    def respond(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == '/api/status':
            self.respond(200, {'ok':True,'apkg':True,'localOnly':True})
        else:
            super().do_GET()
    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path != '/api/import-apkg':
            self.respond(404, {'ok':False,'error':'NOT_FOUND'})
            return
        host = self.headers.get('Host', '')
        origins = {'http://127.0.0.1:' + str(self.server.server_port), 'http://localhost:' + str(self.server.server_port)}
        if host not in {o.split('//')[1] for o in origins} or self.headers.get('Origin') not in origins or self.headers.get('X-Bir-Import') != '1':
            self.respond(403, {'ok':False,'error':'LOCAL_REQUEST_REQUIRED'})
            return
        try:
            length = int(self.headers.get('Content-Length', '-1'))
        except ValueError:
            length = -1
        if length < 1 or length > MAX_UPLOAD:
            self.respond(413, {'ok':False,'error':'FILE_TOO_LARGE'})
            return
        if not IMPORT_LOCK.acquire(blocking=False):
            self.respond(409, {'ok':False,'error':'IMPORT_BUSY'})
            return
        directory = None
        try:
            directory = pathlib.Path(tempfile.mkdtemp(prefix='request-', dir=WORK)).resolve()
            upload = directory / 'upload.apkg'
            remaining = length
            with upload.open('wb') as destination:
                while remaining:
                    block = self.rfile.read(min(1024*1024, remaining))
                    if not block:
                        raise RuntimeError('INCOMPLETE_UPLOAD')
                    destination.write(block)
                    remaining -= len(block)
            self.respond(200, import_package(upload, directory))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except subprocess.TimeoutExpired:
            self.respond(422, {'ok':False,'error':'IMPORT_TIMEOUT'})
        except Exception as error:
            self.respond(422, {'ok':False,'error':str(error)[:240]})
        finally:
            if directory is not None and directory.name.startswith('request-') and directory.resolve().is_relative_to(WORK.resolve()):
                shutil.rmtree(directory, ignore_errors=True)
            IMPORT_LOCK.release()

class LocalServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = False

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=64008)
    args = parser.parse_args()
    server = LocalServer(('127.0.0.1',args.port),Handler)
    (WORK.parent / 'server-state.json').write_text(json.dumps({'pid':os.getpid(),'url':f'http://127.0.0.1:{server.server_port}','script':str(pathlib.Path(__file__).resolve())}),encoding='utf-8')
    print(f'http://127.0.0.1:{server.server_port}',flush=True)
    server.serve_forever()
