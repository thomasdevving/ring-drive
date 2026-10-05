#!/usr/bin/env python3
"""Generate a deterministic Xcode project without an external generator dependency."""
import hashlib, json, plistlib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
project = root / 'RingDrive.xcodeproj'
project.mkdir(exist_ok=True)
objects = {}
def ident(key): return hashlib.sha1(key.encode()).hexdigest()[:24].upper()
def q(value): return json.dumps(str(value))
def add(key, body):
    key = ident(key); objects[key] = body; return key
def refs(ids): return '(' + ', '.join(ids) + ', )' if ids else '()'

products = []
files = []
targets = []
config_ids = []
app_id = ident('target:RingDrive')
widget_id = ident('target:RingDriveWidgets')
test_id = ident('target:RingDriveUITests')
package_ref = add('package', 'isa = XCLocalSwiftPackageReference; relativePath = .;')
package_product = add('core-product', f'isa = XCSwiftPackageProductDependency; package = {package_ref}; productName = RingDriveCore;')
package_build = add('core-build', f'isa = PBXBuildFile; productRef = {package_product};')

for name, patterns, product_type, extension in [
    ('RingDrive', ['iOS/App/*.swift', 'iOS/Shared/*.swift', 'iOS/CarPlay/*.swift'], 'com.apple.product-type.application', 'app'),
    ('RingDriveWidgets', ['iOS/Widgets/*.swift', 'iOS/Shared/*.swift'], 'com.apple.product-type.app-extension', 'appex'),
    ('RingDriveUITests', ['iOS/UITests/*.swift'], 'com.apple.product-type.bundle.ui-testing', 'xctest')
]:
    builds = []
    for pattern in patterns:
        for path in sorted(root.glob(pattern)):
            relative = str(path.relative_to(root)); ref = ident('file:' + relative)
            if ref not in objects:
                add('file:' + relative, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {q(relative)}; sourceTree = SOURCE_ROOT;')
                files.append(ref)
            builds.append(add(name + ':build:' + relative, f'isa = PBXBuildFile; fileRef = {ref};'))
    source_phase = add(name + ':sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {refs(builds)}; runOnlyForDeploymentPostprocessing = 0;')
    framework_phase = add(name + ':frameworks', f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = {refs([package_build] if name == "RingDrive" else [])}; runOnlyForDeploymentPostprocessing = 0;')
    resources = []
    if name == 'RingDrive':
        for path in [root / 'iOS/Resources/demo-incident.mp4', root / 'iOS/Resources/Assets.xcassets']:
            relative = str(path.relative_to(root)); ref = add('file:' + relative, f'isa = PBXFileReference; lastKnownFileType = {"folder.assetcatalog" if path.suffix == ".xcassets" else "file"}; path = {q(relative)}; sourceTree = SOURCE_ROOT;')
            files.append(ref); resources.append(add('resource:' + relative, f'isa = PBXBuildFile; fileRef = {ref};'))
    resource_phase = add(name + ':resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = {refs(resources)}; runOnlyForDeploymentPostprocessing = 0;')
    phases = [source_phase, framework_phase, resource_phase]
    dependencies = []
    if name == 'RingDrive':
        widget_product = ident('product:RingDriveWidgets')
        embed_build = add('embed-widget-build', f'isa = PBXBuildFile; fileRef = {widget_product}; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, );}};')
        phases.append(add('embed-widget', f'isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = {refs([embed_build])}; name = "Embed App Extensions"; runOnlyForDeploymentPostprocessing = 0;'))
        proxy = add('widget-proxy', f'isa = PBXContainerItemProxy; containerPortal = {ident("project")}; proxyType = 1; remoteGlobalIDString = {widget_id}; remoteInfo = RingDriveWidgets;')
        dependencies.append(add('widget-dependency', f'isa = PBXTargetDependency; target = {widget_id}; targetProxy = {proxy};'))
    if name == 'RingDriveUITests':
        proxy = add('app-proxy', f'isa = PBXContainerItemProxy; containerPortal = {ident("project")}; proxyType = 1; remoteGlobalIDString = {app_id}; remoteInfo = RingDrive;')
        dependencies.append(add('app-dependency', f'isa = PBXTargetDependency; target = {app_id}; targetProxy = {proxy};'))
    configs = []
    for configuration in ['Debug', 'Release']:
        settings = {
            'PRODUCT_BUNDLE_IDENTIFIER': 'dev.ringdrive.demo' + ('.widgets' if extension == 'appex' else '.uitests' if extension == 'xctest' else ''),
            'PRODUCT_NAME': '$(TARGET_NAME)', 'SWIFT_VERSION': '5.0', 'IPHONEOS_DEPLOYMENT_TARGET': '26.0',
            'TARGETED_DEVICE_FAMILY': '1', 'CODE_SIGN_STYLE': 'Automatic', 'CURRENT_PROJECT_VERSION': '1',
            'MARKETING_VERSION': '0.1.0', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if configuration == 'Debug' else '-O',
            'SDKROOT': 'iphoneos', 'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator',
            'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks',
            'GENERATE_INFOPLIST_FILE': 'NO' if extension != 'xctest' else 'YES'
        }
        if name == 'RingDrive':
            settings.update(INFOPLIST_FILE='iOS/App/Info.plist', ASSETCATALOG_COMPILER_APPICON_NAME='AppIcon', ENABLE_PREVIEWS='YES')
        elif extension == 'appex':
            settings.update(INFOPLIST_FILE='iOS/Widgets/Info.plist', APPLICATION_EXTENSION_API_ONLY='YES', SKIP_INSTALL='YES', LD_RUNPATH_SEARCH_PATHS='$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks')
        else: settings.update(TEST_TARGET_NAME='RingDrive')
        if configuration == 'Debug':
            settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) DEBUG'
            settings['ONLY_ACTIVE_ARCH'] = 'YES'
        configs.append(add(name + ':' + configuration, 'isa = XCBuildConfiguration; buildSettings = {' + ''.join(f'{k} = {q(v)};' for k,v in settings.items()) + f'}}; name = {configuration};'))
    configs_list = add(name + ':config-list', f'isa = XCConfigurationList; buildConfigurations = {refs(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
    product_ref = add('product:' + name, f'isa = PBXFileReference; explicitFileType = {"wrapper.application" if extension == "app" else "wrapper.app-extension" if extension == "appex" else "wrapper.cfbundle"}; includeInIndex = 0; path = {name}.{extension}; sourceTree = BUILT_PRODUCTS_DIR;')
    products.append(product_ref)
    target = add('target:' + name, f'isa = PBXNativeTarget; buildConfigurationList = {configs_list}; buildPhases = {refs(phases)}; buildRules = (); dependencies = {refs(dependencies)}; name = {name}; packageProductDependencies = {refs([package_product] if name == "RingDrive" else [])}; productName = {name}; productReference = {product_ref}; productType = {q(product_type)};')
    targets.append(target)

main_group = add('main-group', f'isa = PBXGroup; children = {refs(files + [ident("products-group")])}; sourceTree = "<group>";')
add('products-group', f'isa = PBXGroup; children = {refs(products)}; name = Products; sourceTree = "<group>";')
for name in ['Debug', 'Release']:
    config_ids.append(add('project:' + name, f'isa = XCBuildConfiguration; buildSettings = {{CLANG_ENABLE_MODULES = YES; ENABLE_USER_SCRIPT_SANDBOXING = YES; SWIFT_STRICT_CONCURRENCY = targeted; DEBUG_INFORMATION_FORMAT = dwarf;}}; name = {name};'))
project_configs = add('project-configs', f'isa = XCConfigurationList; buildConfigurations = {refs(config_ids)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
project_id = add('project', f'isa = PBXProject; attributes = {{LastUpgradeCheck = 2610; TargetAttributes = {{{test_id} = {{TestTargetID = {app_id};}};}};}}; buildConfigurationList = {project_configs}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base, ); mainGroup = {main_group}; packageReferences = {refs([package_ref])}; productRefGroup = {ident("products-group")}; projectDirPath = ""; projectRoot = ""; targets = {refs(targets)};')
contents = '// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(f'{k} = {{{v}}};' for k,v in objects.items()) + f'\n}}; rootObject = {project_id};}}\n'
(project / 'project.pbxproj').write_text(contents)

base = {'CFBundleDevelopmentRegion':'en','CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'$(PRODUCT_NAME)','CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)'}
app = base | {'CFBundlePackageType':'APPL','CFBundleDisplayName':'Ring Drive','NSSupportsLiveActivities':True,'NSLocationWhenInUseUsageDescription':'Find nearby parking and verify that the vehicle is stationary before video review.','NSMotionUsageDescription':'Use stationary motion evidence to protect video review while driving.','UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],'CFBundleURLTypes':[{'CFBundleURLSchemes':['ringdrive']}],'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False}}
widget = base | {'CFBundlePackageType':'XPC!','NSExtension':{'NSExtensionPointIdentifier':'com.apple.widgetkit-extension'}}
for dest, data in [('iOS/App/Info.plist',app),('iOS/Widgets/Info.plist',widget)]:
    (root / dest).write_bytes(plistlib.dumps(data))

schemes = project / 'xcshareddata/xcschemes'; schemes.mkdir(parents=True, exist_ok=True)
def entry(target, name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:RingDrive.xcodeproj"/>'
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2610" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{entry(app_id,'RingDrive.app')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{entry(test_id,'RingDriveUITests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{entry(app_id,'RingDrive.app')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{entry(app_id,'RingDrive.app')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>'''
(schemes / 'RingDrive.xcscheme').write_text(scheme)
print('Generated RingDrive.xcodeproj')
