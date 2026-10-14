#!/usr/bin/env python3
"""Static checks. This does not replace xcodebuild or XCTest on a Mac."""
from pathlib import Path
import json
import plistlib
import struct
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
errors = []
swift_files = list((root / 'Shared').rglob('*.swift')) + list((root / 'Tests').rglob('*.swift')) + [root / 'Package.swift']
try:
    from tree_sitter import Language, Parser
    import tree_sitter_swift
    parser = Parser(Language(tree_sitter_swift.language()))
    for path in swift_files:
        tree = parser.parse(path.read_bytes())
        if tree.root_node.has_error: errors.append('Swift syntax: ' + path.relative_to(root).as_posix())
    print('Swift syntax trees checked:', len(swift_files))
except ImportError:
    print('Swift syntax parser not installed; skipped (run Xcode compilation).')

try:
    from openstep_parser import OpenStepDecoder
    project = OpenStepDecoder.ParseFromString((root / 'GuangyiWorkSpace.xcodeproj/project.pbxproj').read_text())
    objects = project['objects']
    refs = {key: value for key, value in objects.items() if value.get('isa') == 'PBXFileReference'}
    for key, value in refs.items():
        if value.get('sourceTree') != 'BUILT_PRODUCTS_DIR' and not (root / value['path']).exists(): errors.append('Missing file: ' + value['path'])
    for value in objects.values():
        if value.get('isa') == 'PBXBuildFile' and value['fileRef'] not in refs: errors.append('Missing PBX file reference')
    targets = [v for v in objects.values() if v.get('isa') == 'PBXNativeTarget']
    if len(targets) != 3: errors.append('Expected two applications and one test target')
    expected = {p.relative_to(root).as_posix() for p in (root / 'Shared').rglob('*.swift')}
    for target in targets:
        source_phase = next(objects[key] for key in target['buildPhases'] if objects[key]['isa'] == 'PBXSourcesBuildPhase')
        sources = {refs[objects[key]['fileRef']]['path'] for key in source_phase['files']}
        if target['productType'] == 'com.apple.product-type.application' and sources != expected:
            errors.append('Application source mismatch: ' + target['name'])
    print('Xcode OpenStep graph checked:', len(objects), 'objects,', len(targets), 'targets')
except ImportError:
    print('OpenStep parser not installed; skipped (Xcode reads the project natively).')

for file in (root / 'Config').iterdir():
    if file.suffix == '.plist' or '.entitlements' in file.name:
        plistlib.loads(file.read_bytes())
for file in (root / 'GuangyiWorkSpace.xcodeproj/xcshareddata/xcschemes').glob('*.xcscheme'):
    tree = ET.parse(file)
    if tree.getroot().tag != 'Scheme': errors.append('Invalid scheme: ' + file.name)
for catalog in (root / 'Shared/Assets.xcassets').rglob('Contents.json'):
    contents = json.loads(catalog.read_text())
    for image in contents.get('images', []):
        if 'filename' not in image: continue
        path = catalog.parent / image['filename']
        bytes_ = path.read_bytes()
        if bytes_[:8] != b'\x89PNG\r\n\x1a\n': errors.append('Not PNG: ' + path.name); continue
        width, height = struct.unpack('>II', bytes_[16:24])
        expected = int(float(image['size'].split('x')[0]) * float(image.get('scale', '1x')[:-1]))
        if width != expected or height != expected: errors.append('Icon size mismatch: ' + path.name)
print('Plists, schemes and icon dimensions checked')
if errors:
    raise SystemExit('\n'.join(errors))
print('Available static checks passed. Apple-platform build/run remains unverified.')
