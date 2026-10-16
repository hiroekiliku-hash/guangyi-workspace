#!/usr/bin/env python3
"""Compile shipping Swift transport/merge code and exercise a disposable Node API."""
from pathlib import Path
import argparse
import json
import os
import secrets
import select
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default=shutil.which('node'), help='Node.js 24 or newer')
    parser.add_argument('--output', type=Path, help='Save the non-sensitive acceptance report')
    args = parser.parse_args()
    if sys.platform != 'darwin' or not args.node:
        parser.error('Requires macOS, full Xcode and Node.js 24 or newer')
    node_version = subprocess.check_output([args.node, '--version'], text=True).strip()
    if int(node_version.lstrip('v').split('.')[0]) < 24:
        parser.error('Requires Node.js 24 or newer for built-in SQLite')
    environment = os.environ.copy()
    if not environment.get('DEVELOPER_DIR'):
        selected = subprocess.check_output(['/usr/bin/xcode-select', '-p'], text=True).strip()
        environment['DEVELOPER_DIR'] = selected if selected.endswith('/Contents/Developer') else '/Applications/Xcode.app/Contents/Developer'
    swift = subprocess.check_output(['/usr/bin/xcrun', '--find', 'swiftc'], env=environment, text=True).strip()
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path'], env=environment, text=True).strip()
    environment['GUANGYI_ACCEPTANCE_PASSWORD'] = secrets.token_urlsafe(36)
    with tempfile.TemporaryDirectory(prefix='guangyi-native-server-') as directory:
        temporary = Path(directory)
        executable = temporary / 'native-server-sync'
        sources = sorted((ROOT / 'Shared/Core').glob('*.swift')) + [
            ROOT / 'Shared/Services/ArchiveService.swift',
            ROOT / 'Shared/Services/BackendService.swift',
            ROOT / 'Shared/Services/PasskeyAuthorization.swift',
            ROOT / 'Scripts/Acceptance/NativeServerSync.swift',
        ]
        subprocess.run([swift, '-parse-as-library', '-swift-version', '5', '-sdk', sdk,
                        '-module-cache-path', str(temporary / 'ModuleCache'),
                        *map(str, sources), '-o', str(executable)], env=environment, check=True, timeout=180)
        server = subprocess.Popen([args.node, str(ROOT / 'Scripts/Acceptance/native-sync-server.mjs')],
                                  cwd=ROOT, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        try:
            if not select.select([server.stdout], [], [], 20)[0]:
                raise RuntimeError('Isolated API did not become ready')
            ready = json.loads(server.stdout.readline())
            environment['GUANGYI_ACCEPTANCE_ORIGIN'] = ready['origin']
            result = subprocess.run([str(executable)], env=environment, check=True,
                                    capture_output=True, text=True, timeout=90)
            report = json.loads(result.stdout)
            report['nodeVersion'] = node_version
            serialized = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
            if args.output:
                args.output.write_text(serialized)
            print(serialized, end='')
        finally:
            if server.poll() is None:
                try:
                    server.stdin.write('stop\n')
                    server.stdin.flush()
                    server.wait(timeout=5)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    server.terminate()
                    try:
                        server.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait()
            server.stdin.close()
            server.stdout.close()
            server.stderr.close()


if __name__ == '__main__':
    try:
        run()
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr, file=sys.stderr, end='')
        raise SystemExit(error.returncode)
