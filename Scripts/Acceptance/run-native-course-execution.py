#!/usr/bin/env python3
"""Compile shipping Swift transport and test a supplied disposable loopback API."""
from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Save the credential-free JSON report')
    parser.add_argument('--executable', type=Path, help='Keep the compiled acceptance executable here')
    parser.add_argument('--build-only', action='store_true', help='Compile without contacting an API; requires --executable')
    parser.add_argument('--reuse-executable', action='store_true', help='Use an existing --executable without rebuilding')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Requires macOS and full Xcode')
    if (args.build_only or args.reuse_executable) and not args.executable:
        parser.error('--build-only and --reuse-executable require --executable')
    if args.build_only and args.reuse_executable:
        parser.error('Choose build-only or reuse-executable')
    environment = os.environ.copy()
    if not args.build_only and (not environment.get('GUANGYI_ACCEPTANCE_ORIGIN') or len(environment.get('GUANGYI_ACCEPTANCE_PASSWORD', '')) < 32):
        parser.error('GUANGYI_ACCEPTANCE_ORIGIN and a disposable 32+ character GUANGYI_ACCEPTANCE_PASSWORD are required')
    if not environment.get('DEVELOPER_DIR'):
        selected = subprocess.check_output(['/usr/bin/xcode-select', '-p'], text=True).strip()
        environment['DEVELOPER_DIR'] = selected if selected.endswith('/Contents/Developer') else '/Applications/Xcode.app/Contents/Developer'
    with tempfile.TemporaryDirectory(prefix='workshop-course-execution-') as directory:
        temporary = Path(directory)
        executable = args.executable.resolve() if args.executable else temporary / 'native-course-execution'
        if not args.reuse_executable:
            swift = subprocess.check_output(['/usr/bin/xcrun', '--find', 'swiftc'], env=environment, text=True).strip()
            sdk = subprocess.check_output(['/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path'], env=environment, text=True).strip()
            sources = sorted((ROOT / 'Shared/Core').glob('*.swift')) + [
                ROOT / 'Shared/Services/ArchiveService.swift',
                ROOT / 'Shared/Services/BackendService.swift',
                ROOT / 'Shared/Services/PasskeyAuthorization.swift',
                ROOT / 'Shared/Services/CourseCodeRunner.swift',
                ROOT / 'Scripts/Acceptance/NativeCourseExecution.swift',
            ]
            executable.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([swift, '-parse-as-library', '-swift-version', '5', '-sdk', sdk,
                            '-module-cache-path', str(temporary / 'ModuleCache'), *map(str, sources),
                            '-o', str(executable)], env=environment, check=True, timeout=180)
        if args.build_only:
            print(json.dumps({'ok': True, 'buildOnly': True, 'source': 'shipping Swift transport and runner result model', 'productionAccess': False}))
            return
        result = subprocess.run([str(executable)], env=environment, capture_output=True, text=True, timeout=100)
        try:
            report = json.loads(result.stdout)
        except json.JSONDecodeError:
            report = {'ok': False, 'error': 'NATIVE_ACCEPTANCE_REPORT_MISSING', 'productionAccess': False}
        serialized = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            args.output.write_text(serialized)
        print(serialized, end='')
        if result.returncode or report.get('ok') is not True:
            raise SystemExit(result.returncode or 1)


if __name__ == '__main__':
    try:
        run()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        print(json.dumps({'ok': False, 'error': 'ACCEPTANCE_BUILD_OR_PROCESS_FAILED', 'productionAccess': False}))
        raise SystemExit(1)
