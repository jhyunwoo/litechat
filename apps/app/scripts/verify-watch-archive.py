#!/usr/bin/env python3
"""Run on macOS against an exported .ipa or containing .app; never print credentials."""
import pathlib, plistlib, subprocess, sys, tempfile, zipfile
p = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='litechat-watch-archive-') as temp:
    if p.suffix == '.ipa':
        with zipfile.ZipFile(p) as z: z.extractall(temp)
        p = next((pathlib.Path(temp) / 'Payload').glob('*.app'))
    candidates = list((p / 'Watch').glob('*.app'))
    assert len(candidates) == 1, 'Expected one embedded Watch app'
    watch = candidates[0]
    info = plistlib.loads((watch / 'Info.plist').read_bytes())
    assert info['CFBundleIdentifier'] == 'kr.moveto.litechat.watch'
    assert info['WKCompanionAppBundleIdentifier'] == 'kr.moveto.litechat'
    assert info['WKRunsIndependentlyOfCompanionApp'] is True
    assert not info.get('WKWatchOnly', False)
    assert info['MinimumOSVersion'].split('.')[0] == '10'
    phone = plistlib.loads((p / 'Info.plist').read_bytes())
    for key in ['CFBundleVersion','CFBundleShortVersionString']: assert info[key] == phone[key], key
    subprocess.run(['codesign','--verify','--deep','--strict',str(p)],check=True,capture_output=True)
    result = subprocess.run(['codesign','-d','--entitlements',':-',str(watch)],check=True,capture_output=True)
    ent = plistlib.loads(result.stdout)
    env = ent['aps-environment']
    assert env in ['development','production']
    assert info['LiteChatAPNsEnvironment'] == ('sandbox' if env == 'development' else 'production')
    assert ent['application-identifier'].endswith('.kr.moveto.litechat.watch')
    profile = watch / 'embedded.mobileprovision'
    if profile.exists():
        profile_data = subprocess.check_output(['security','cms','-D','-i',str(profile)])
        provisioning = plistlib.loads(profile_data)['Entitlements']
        assert provisioning['aps-environment'] == env
        assert provisioning['application-identifier'] == ent['application-identifier']
    assert (watch/'Assets.car').exists(), 'Watch icons/assets missing'
    print('PASS: embedded independent Watch, signed entitlement/environment, versions and assets')
