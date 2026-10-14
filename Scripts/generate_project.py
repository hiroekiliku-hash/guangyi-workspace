#!/usr/bin/env python3
"""Generate the checked-in Xcode project. No XcodeGen or third-party package needed."""
from pathlib import Path
import hashlib
import json
import subprocess
import runpy
import plistlib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "GuangyiWorkSpace.xcodeproj"
PROJECT.mkdir(exist_ok=True)
# Retain signing and bundle identifiers if regenerating an existing local project.
existing_plists = {p.name: plistlib.loads(p.read_bytes()) for p in (ROOT / 'Config').glob('*.plist')}
existing_settings = {}
if (PROJECT / 'project.pbxproj').exists():
    existing = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(PROJECT / 'project.pbxproj')]))
    graph = existing['objects']
    for target in graph.values():
        if target.get('isa') == 'PBXNativeTarget':
            for config_id in graph[target['buildConfigurationList']]['buildConfigurations']:
                config = graph[config_id]
                existing_settings[(target['name'], config['name'])] = {k: v for k, v in config['buildSettings'].items() if k.startswith('CODE_SIGN') or k in ['DEVELOPMENT_TEAM', 'PRODUCT_BUNDLE_IDENTIFIER', 'MARKETING_VERSION', 'CURRENT_PROJECT_VERSION']}
objects = {}
def ident(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def obj(key_name, **values):
    key = ident(key_name); objects[key] = values; return key
def quoted(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
def encode(value, indent=0):
    pad = '\t' * indent
    if isinstance(value, dict):
        return '{\n' + ''.join('\t' * (indent + 1) + quoted(k) + ' = ' + encode(v, indent + 1) + ';\n' for k, v in value.items()) + pad + '}'
    if isinstance(value, list):
        return '(\n' + ''.join('\t' * (indent + 1) + encode(v, indent + 1) + ',\n' for v in value) + pad + ')'
    return quoted(value)

shared = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "Shared").rglob('*.swift'))
core = [p for p in shared if p.startswith('Shared/Core/')]
tests = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "Tests").rglob('*.swift'))
refs = {}
for path in shared + tests:
    refs[path] = obj('file:' + path, isa='PBXFileReference', lastKnownFileType='sourcecode.swift', path=path, sourceTree='<group>')
assets = obj('assets', isa='PBXFileReference', lastKnownFileType='folder.assetcatalog', path='Shared/Assets.xcassets', sourceTree='<group>')
config_refs = []
for name in ['iOS-Info.plist', 'Mac-Info.plist', 'iOS.entitlements', 'Mac.entitlements', 'Push-iOS.entitlements.example', 'Push-Mac.entitlements.example']:
    config_refs.append(obj('config:' + name, isa='PBXFileReference', lastKnownFileType='text.plist.xml', path='Config/' + name, sourceTree='<group>'))
products = []
targets = []
target_names = [('iOS', 'GuangyiWorkSpace-iOS'), ('Mac', 'GuangyiWorkSpace-Mac'), ('Tests', 'WorkspaceCoreTests')]
common = {'SWIFT_VERSION': '5.0', 'SWIFT_STRICT_CONCURRENCY': 'minimal', 'CLANG_ENABLE_MODULES': 'YES',
    'CLANG_ENABLE_OBJC_ARC': 'YES', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES', 'CODE_SIGN_STYLE': 'Automatic',
    'MARKETING_VERSION': '1.0', 'CURRENT_PROJECT_VERSION': '1', 'DEVELOPMENT_TEAM': ''}
for platform, name in target_names:
    test_target = platform == 'Tests'
    sources = core + tests + ['Shared/Services/ArchiveService.swift', 'Shared/Storage/SwiftDataRepository.swift'] if test_target else shared
    source_files = [obj('build:' + platform + ':' + path, isa='PBXBuildFile', fileRef=refs[path]) for path in sources]
    source_phase = obj('sources:' + platform, isa='PBXSourcesBuildPhase', buildActionMask='2147483647', files=source_files, runOnlyForDeploymentPostprocessing='0')
    resource_files = [] if test_target else [obj('resource:' + platform, isa='PBXBuildFile', fileRef=assets)]
    resource_phase = obj('resources:' + platform, isa='PBXResourcesBuildPhase', buildActionMask='2147483647', files=resource_files, runOnlyForDeploymentPostprocessing='0')
    framework_phase = obj('frameworks:' + platform, isa='PBXFrameworksBuildPhase', buildActionMask='2147483647', files=[], runOnlyForDeploymentPostprocessing='0')
    extension = '.xctest' if test_target else '.app'
    product = obj('product:' + platform, isa='PBXFileReference', explicitFileType='wrapper.cfbundle' if test_target else 'wrapper.application', includeInIndex='0', path=name + extension, sourceTree='BUILT_PRODUCTS_DIR')
    products.append(product)
    configurations = []
    for mode in ['Debug', 'Release']:
        settings = dict(common)
        settings.update({'PRODUCT_NAME': '$(TARGET_NAME)', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if mode == 'Debug' else '-O',
            'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG $(inherited)' if mode == 'Debug' else '$(inherited)',
            'DEBUG_INFORMATION_FORMAT': 'dwarf' if mode == 'Debug' else 'dwarf-with-dsym'})
        if platform == 'iOS':
            settings.update({'SDKROOT': 'iphoneos', 'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0',
                'TARGETED_DEVICE_FAMILY': '1,2', 'SUPPORTS_MACCATALYST': 'NO', 'INFOPLIST_FILE': 'Config/iOS-Info.plist',
                'PRODUCT_BUNDLE_IDENTIFIER': 'com.guangyi.workspace.native.ios', 'CODE_SIGN_ENTITLEMENTS': 'Config/iOS.entitlements', 'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
                'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks']})
        else:
            settings.update({'SDKROOT': 'macosx', 'SUPPORTED_PLATFORMS': 'macosx', 'MACOSX_DEPLOYMENT_TARGET': '14.0',
                'CODE_SIGN_IDENTITY': '-' if mode == 'Debug' else 'Apple Development',
                'PRODUCT_BUNDLE_IDENTIFIER': 'com.guangyi.workspace.native.tests' if test_target else 'com.guangyi.workspace.native.mac',
                'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/../Frameworks', '@loader_path/../Frameworks']})
            if test_target:
                settings.update({'GENERATE_INFOPLIST_FILE': 'YES', 'SKIP_INSTALL': 'YES',
                    'FRAMEWORK_SEARCH_PATHS': ['$(inherited)', '$(PLATFORM_DIR)/Developer/Library/Frameworks']})
            else:
                settings.update({'INFOPLIST_FILE': 'Config/Mac-Info.plist', 'CODE_SIGN_ENTITLEMENTS': 'Config/Mac.entitlements',
                    'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'ENABLE_HARDENED_RUNTIME': 'YES'})
        settings.update(existing_settings.get((name, mode), {}))
        configurations.append(obj('configuration:' + platform + ':' + mode, isa='XCBuildConfiguration', buildSettings=settings, name=mode))
    config_list = obj('configurations:' + platform, isa='XCConfigurationList', buildConfigurations=configurations, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')
    target = obj('target:' + platform, isa='PBXNativeTarget', buildConfigurationList=config_list,
        buildPhases=[source_phase, framework_phase, resource_phase], buildRules=[], dependencies=[], name=name,
        productName=name, productReference=product, productType='com.apple.product-type.bundle.unit-test' if test_target else 'com.apple.product-type.application')
    targets.append(target)
shared_group = obj('shared-group', isa='PBXGroup', children=[refs[p] for p in shared] + [assets], name='Shared', sourceTree='<group>')
test_group = obj('test-group', isa='PBXGroup', children=[refs[p] for p in tests], name='Tests', sourceTree='<group>')
config_group = obj('config-group', isa='PBXGroup', children=config_refs, name='Config', sourceTree='<group>')
products_group = obj('products-group', isa='PBXGroup', children=products, name='Products', sourceTree='<group>')
main_group = obj('main-group', isa='PBXGroup', children=[shared_group, test_group, config_group, products_group], sourceTree='<group>')
project_configs = [obj('project-config:' + mode, isa='XCBuildConfiguration', buildSettings={'ALWAYS_SEARCH_USER_PATHS': 'NO', 'CLANG_ENABLE_MODULES': 'YES'}, name=mode) for mode in ['Debug', 'Release']]
project_config_list = obj('project-configs', isa='XCConfigurationList', buildConfigurations=project_configs, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')
project_id = obj('project', isa='PBXProject', attributes={'LastUpgradeCheck': '1600', 'BuildIndependentTargetsInParallel': 'YES',
    'TargetAttributes': {target: {'CreatedOnToolsVersion': '16.0'} for target in targets}}, buildConfigurationList=project_config_list,
    compatibilityVersion='Xcode 14.0', developmentRegion='zh-Hans', knownRegions=['zh-Hans', 'en', 'Base'], mainGroup=main_group,
    productRefGroup=products_group, projectDirPath='', projectRoot='', targets=targets)
document = {'archiveVersion': '1', 'classes': {}, 'objectVersion': '56', 'objects': objects, 'rootObject': project_id}
(PROJECT / 'project.pbxproj').write_text('// !$*UTF8*$!\n' + encode(document) + '\n')

schemes = PROJECT / 'xcshareddata/xcschemes'; schemes.mkdir(parents=True, exist_ok=True)
for platform, name in target_names:
    target = ident('target:' + platform)
    suffix = '.xctest' if platform == 'Tests' else '.app'
    ref = {'BuildableIdentifier': 'primary', 'BlueprintIdentifier': target, 'BuildableName': name + suffix, 'BlueprintName': name, 'ReferencedContainer': 'container:GuangyiWorkSpace.xcodeproj'}
    scheme = ET.Element('Scheme', {'LastUpgradeVersion': '1600', 'version': '1.3'})
    build = ET.SubElement(scheme, 'BuildAction', {'parallelizeBuildables': 'YES', 'buildImplicitDependencies': 'YES'})
    entry = ET.SubElement(ET.SubElement(build, 'BuildActionEntries'), 'BuildActionEntry', {'buildForTesting': 'YES', 'buildForRunning': 'NO' if platform == 'Tests' else 'YES', 'buildForProfiling': 'NO' if platform == 'Tests' else 'YES', 'buildForArchiving': 'NO' if platform == 'Tests' else 'YES', 'buildForAnalyzing': 'YES'})
    ET.SubElement(entry, 'BuildableReference', ref)
    test = ET.SubElement(scheme, 'TestAction', {'buildConfiguration': 'Debug', 'selectedDebuggerIdentifier': 'Xcode.DebuggerFoundation.Debugger.LLDB', 'selectedLauncherIdentifier': 'Xcode.IDEFoundation.Launcher.LLDB', 'shouldUseLaunchSchemeArgsEnv': 'YES'})
    testables = ET.SubElement(test, 'Testables')
    if platform in ['Tests', 'Mac']:
        testable = ET.SubElement(testables, 'TestableReference', {'skipped': 'NO'})
        ET.SubElement(testable, 'BuildableReference', {'BuildableIdentifier': 'primary', 'BlueprintIdentifier': ident('target:Tests'), 'BuildableName': 'WorkspaceCoreTests.xctest', 'BlueprintName': 'WorkspaceCoreTests', 'ReferencedContainer': 'container:GuangyiWorkSpace.xcodeproj'})
    launch = ET.SubElement(scheme, 'LaunchAction', {'buildConfiguration': 'Debug', 'selectedDebuggerIdentifier': 'Xcode.DebuggerFoundation.Debugger.LLDB', 'selectedLauncherIdentifier': 'Xcode.IDEFoundation.Launcher.LLDB', 'launchStyle': '0', 'useCustomWorkingDirectory': 'NO', 'ignoresPersistentStateOnLaunch': 'NO', 'debugDocumentVersioning': 'YES', 'allowLocationSimulation': 'YES'})
    if platform != 'Tests': ET.SubElement(ET.SubElement(launch, 'BuildableProductRunnable', {'runnableDebuggingMode': '0'}), 'BuildableReference', ref)
    ET.SubElement(scheme, 'ProfileAction', {'buildConfiguration': 'Release', 'shouldUseLaunchSchemeArgsEnv': 'YES', 'savedToolIdentifier': '', 'useCustomWorkingDirectory': 'NO', 'debugDocumentVersioning': 'YES'})
    ET.SubElement(scheme, 'AnalyzeAction', {'buildConfiguration': 'Debug'})
    ET.SubElement(scheme, 'ArchiveAction', {'buildConfiguration': 'Release', 'revealArchiveInOrganizer': 'YES'})
    ET.indent(scheme)
    ET.ElementTree(scheme).write(schemes / (name + '.xcscheme'), encoding='utf-8', xml_declaration=True)
workspace = PROJECT / 'project.xcworkspace'; workspace.mkdir(exist_ok=True)
(workspace / 'contents.xcworkspacedata').write_text('<?xml version="1.0" encoding="UTF-8"?><Workspace version="1.0"><FileRef location="self:"></FileRef></Workspace>\n')

base_info = {'CFBundleDevelopmentRegion': 'zh-Hans', 'CFBundleDisplayName': '广益 WorkSpace', 'CFBundleExecutable': '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleName': '$(PRODUCT_NAME)',
    'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '$(MARKETING_VERSION)', 'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
    'RemotePushEnabled': False,
    'NSCalendarsFullAccessUsageDescription': '将你选择的工作事项加入系统日历。',
    'NSCalendarsUsageDescription': '将你选择的工作事项加入系统日历。',
    'CFBundleURLTypes': [{'CFBundleURLName': 'workspace', 'CFBundleURLSchemes': ['guangyi-workspace']}],
    'UTExportedTypeDeclarations': [{'UTTypeIdentifier': 'com.guangyi.workspace.archive', 'UTTypeDescription': '广益 WorkSpace 加密归档',
        'UTTypeConformsTo': ['public.data'], 'UTTypeTagSpecification': {'public.filename-extension': ['gwspace']}}],
    'CFBundleDocumentTypes': [{'CFBundleTypeName': 'WorkSpace归档', 'CFBundleTypeRole': 'Viewer', 'LSHandlerRank': 'Owner', 'LSItemContentTypes': ['com.guangyi.workspace.archive']}]}
for platform in ['iOS', 'Mac']:
    info = dict(base_info)
    if platform == 'iOS': info.update({'LSRequiresIPhoneOS': True, 'LSSupportsOpeningDocumentsInPlace': False, 'UILaunchScreen': {},
        'UISupportedInterfaceOrientations': ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
        'UIApplicationSupportsIndirectInputEvents': True})
    else: info.update({'LSMinimumSystemVersion': '$(MACOSX_DEPLOYMENT_TARGET)', 'LSApplicationCategoryType': 'public.app-category.productivity', 'NSHighResolutionCapable': True})
    info.update(existing_plists.get(platform + '-Info.plist', {}))
    if platform == 'iOS': info['LSSupportsOpeningDocumentsInPlace'] = False
    (ROOT / 'Config' / (platform + '-Info.plist')).write_bytes(plistlib.dumps(info, sort_keys=False))
if not (ROOT / 'Config/Mac.entitlements').exists():
    (ROOT / 'Config/Mac.entitlements').write_bytes(plistlib.dumps({'com.apple.security.app-sandbox': True,
    'com.apple.security.files.user-selected.read-write': True, 'com.apple.security.network.client': True,
    'com.apple.security.personal-information.calendars': True}))
(ROOT / 'Config/Push-iOS.entitlements.example').write_bytes(plistlib.dumps({'aps-environment': 'development'}))
(ROOT / 'Config/Push-Mac.entitlements.example').write_bytes(plistlib.dumps({'com.apple.security.app-sandbox': True,
    'com.apple.security.files.user-selected.read-write': True, 'com.apple.security.network.client': True,
    'com.apple.security.personal-information.calendars': True,
    'com.apple.developer.aps-environment': 'development'}))
print('Generated Xcode project:', PROJECT)
print('Shared Swift files:', len(shared), 'targets:', len(targets))

runpy.run_path(str(ROOT / 'Scripts/integrate_live_activity.py'), run_name='__main__')
