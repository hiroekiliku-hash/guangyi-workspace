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
    if len(targets) != 4: errors.append('Expected two applications, one test target and one Widget extension')
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

import subprocess
native = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(root / 'GuangyiWorkSpace.xcodeproj/project.pbxproj')]))['objects']
apps = {v['name']: v for v in native.values() if v.get('isa') == 'PBXNativeTarget'}
host = apps['GuangyiWorkSpace-iOS']; widget = apps['DeadlineLiveActivityWidget']
assert any(native[key]['target'] == next(key for key, value in native.items() if value is widget) for key in host['dependencies'])
assert any(native[key].get('dstSubfolderSpec') == '13' for key in host['buildPhases'])
assert plistlib.loads((root/'Config/iOS-Info.plist').read_bytes())['NSSupportsLiveActivities']
assert plistlib.loads((root/'Config/LiveActivity-Info.plist').read_bytes())['NSExtension']['NSExtensionPointIdentifier'] == 'com.apple.widgetkit-extension'
print('Live Activity dependency, embedding and plist declarations checked.')

assert len(apps) == 4
assert any(native[file]['fileRef'] == widget['productReference'] for phase in host['buildPhases'] if native[phase]['isa'] == 'PBXCopyFilesBuildPhase' and native[phase].get('dstSubfolderSpec') == '13' for file in native[phase]['files'])
def configurations(target):
    return {native[key]['name']: native[key]['buildSettings'] for key in native[target['buildConfigurationList']]['buildConfigurations']}
for mode, settings in configurations(host).items():
    extension = configurations(widget)[mode]
    assert extension['PRODUCT_BUNDLE_IDENTIFIER'] == settings['PRODUCT_BUNDLE_IDENTIFIER'] + '.liveactivity'
    for field in ['DEVELOPMENT_TEAM', 'MARKETING_VERSION', 'CURRENT_PROJECT_VERSION', 'IPHONEOS_DEPLOYMENT_TARGET']:
        assert extension.get(field) == settings.get(field), field
print('Widget bundle prefix, inherited signing/version and actual embed product checked.')

for target in apps.values():
    for phase_key in target['buildPhases']:
        phase = native[phase_key]
        if phase['isa'] != 'PBXSourcesBuildPhase': continue
        references = [native[file]['fileRef'] for file in phase['files']]
        assert len(references) == len(set(references)), 'Duplicate Swift source membership'
        for reference in references:
            assert (root / native[reference]['path']).is_file(), native[reference]['path']
print('All target Swift source files exist and have unique membership.')
