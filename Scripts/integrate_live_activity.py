#!/usr/bin/env python3
"""Idempotently add the Live Activity extension without resetting host settings."""
from pathlib import Path
import subprocess, json, hashlib, plistlib

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'GuangyiWorkSpace.xcodeproj/project.pbxproj'
project = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(path)]))
objects = project['objects']
def key(name): return hashlib.sha256(('live-activity:' + name).encode()).hexdigest()[:24].upper()
def add(identity_name, **value):
    ident = key(identity_name); objects[ident] = value; return ident
def append(array, value):
    if value not in array: array.append(value)
def configurations(target):
    return [objects[v] for v in objects[target['buildConfigurationList']]['buildConfigurations']]
def sources(target):
    return next(objects[v] for v in target['buildPhases'] if objects[v]['isa'] == 'PBXSourcesBuildPhase')
root = objects[project['rootObject']]
targets = {objects[v]['name']: (v, objects[v]) for v in root['targets']}
host_id, host = targets['GuangyiWorkSpace-iOS']
shared = objects[root['mainGroup']]
new_sources = ['Shared/Core/DeadlineTrackingPolicy.swift', 'Shared/LiveActivity/DeadlineActivityAttributes.swift',
               'Shared/LiveActivity/DeadlineLiveActivityCoordinator.swift', 'Shared/LiveActivity/DeadlineLiveActivitySection.swift']
refs = {v.get('path'): ident for ident, v in objects.items() if v.get('isa') == 'PBXFileReference'}
for file in new_sources + ['LiveActivityWidget/DeadlineLiveActivityWidget.swift']:
    ref = refs.get(file) or add('file:' + file, isa='PBXFileReference', lastKnownFileType='sourcecode.swift', path=file, sourceTree='<group>')
    refs[file] = ref; append(shared['children'], ref)
for name, (_, target) in targets.items():
    if name not in ['GuangyiWorkSpace-iOS', 'GuangyiWorkSpace-Mac', 'WorkspaceCoreTests']: continue
    for file in new_sources:
        if name == 'WorkspaceCoreTests' and '/Core/' not in file: continue
        phase = sources(target)
        if any(objects[value]['fileRef'] == refs[file] for value in phase['files']): continue
        build = add('source:' + name + ':' + file, isa='PBXBuildFile', fileRef=refs[file])
        append(phase['files'], build)
extension_name = 'DeadlineLiveActivityWidget'
product = add('product', isa='PBXFileReference', explicitFileType='wrapper.app-extension', includeInIndex='0', path=extension_name + '.appex', sourceTree='BUILT_PRODUCTS_DIR')
append(objects[root['productRefGroup']]['children'], product)
widget_sources = [add('widget-source:' + file, isa='PBXBuildFile', fileRef=refs[file]) for file in ['Shared/LiveActivity/DeadlineActivityAttributes.swift', 'LiveActivityWidget/DeadlineLiveActivityWidget.swift']]
phases = [add('widget-sources', isa='PBXSourcesBuildPhase', buildActionMask='2147483647', files=widget_sources, runOnlyForDeploymentPostprocessing='0'),
          add('widget-frameworks', isa='PBXFrameworksBuildPhase', buildActionMask='2147483647', files=[], runOnlyForDeploymentPostprocessing='0'),
          add('widget-resources', isa='PBXResourcesBuildPhase', buildActionMask='2147483647', files=[], runOnlyForDeploymentPostprocessing='0')]
configs=[]
for configuration in configurations(host):
    settings = dict(configuration['buildSettings'])
    for field in ['ASSETCATALOG_COMPILER_APPICON_NAME', 'CODE_SIGN_ENTITLEMENTS', 'SUPPORTS_MACCATALYST']: settings.pop(field, None)
    settings.update({'PRODUCT_NAME': extension_name, 'PRODUCT_BUNDLE_IDENTIFIER': settings['PRODUCT_BUNDLE_IDENTIFIER'] + '.liveactivity',
                     'INFOPLIST_FILE': 'Config/LiveActivity-Info.plist', 'SKIP_INSTALL': 'YES', 'APPLICATION_EXTENSION_API_ONLY': 'YES',
                     'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']})
    configs.append(add('widget-config:' + configuration['name'], isa='XCBuildConfiguration', name=configuration['name'], buildSettings=settings))
config_list=add('widget-configs', isa='XCConfigurationList', buildConfigurations=configs, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')
extension_id=add('target', isa='PBXNativeTarget', name=extension_name, productName=extension_name, productReference=product,
                 productType='com.apple.product-type.app-extension', buildConfigurationList=config_list, buildPhases=phases, buildRules=[], dependencies=[])
append(root['targets'], extension_id)
proxy=add('proxy', isa='PBXContainerItemProxy', containerPortal=project['rootObject'], proxyType='1', remoteGlobalIDString=extension_id, remoteInfo=extension_name)
dependency=add('dependency', isa='PBXTargetDependency', target=extension_id, targetProxy=proxy)
append(host['dependencies'], dependency)
embed_file=add('embed-file', isa='PBXBuildFile', fileRef=product, settings={'ATTRIBUTES': ['RemoveHeadersOnCopy']})
embed=add('embed-phase', isa='PBXCopyFilesBuildPhase', buildActionMask='2147483647', dstPath='', dstSubfolderSpec='13', files=[embed_file], name='Embed App Extensions', runOnlyForDeploymentPostprocessing='0')
append(host['buildPhases'], embed)
root.setdefault('attributes', {}).setdefault('TargetAttributes', {})[extension_id] = {'CreatedOnToolsVersion': '27.0'}

def quote(value): return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
def encode(value, depth=0):
    pad='\t'*depth
    if isinstance(value, dict): return '{\n' + ''.join('\t'*(depth+1)+quote(k)+' = '+encode(v, depth+1)+';\n' for k,v in value.items()) + pad+'}'
    if isinstance(value, list): return '(\n' + ''.join('\t'*(depth+1)+encode(v,depth+1)+',\n' for v in value)+pad+')'
    return quote(value)
path.write_text('// !$*UTF8*$!\n'+encode(project)+'\n')
plist_path=ROOT/'Config/iOS-Info.plist'
info=plistlib.loads(plist_path.read_bytes()); info['NSSupportsLiveActivities']=True
plist_path.write_bytes(plistlib.dumps(info, sort_keys=False))
widget_info={'CFBundleDevelopmentRegion': 'zh-Hans', 'CFBundleDisplayName': '广益 DDL', 'CFBundleExecutable': '$(EXECUTABLE_NAME)',
             'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleName': '$(PRODUCT_NAME)',
             'CFBundlePackageType': 'XPC!', 'CFBundleShortVersionString': '$(MARKETING_VERSION)', 'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
             'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.widgetkit-extension'}}
(ROOT/'Config/LiveActivity-Info.plist').write_bytes(plistlib.dumps(widget_info, sort_keys=False))
print('Integrated Live Activity target, dependency and PlugIns embed; host settings preserved.')
