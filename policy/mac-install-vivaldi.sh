#!/bin/bash
# Creative AI Vivaldi Extension - Enterprise Force Install
# Run this once in Terminal: bash mac-install-vivaldi.sh
# Vivaldi will install and auto-update the extension automatically.

set -e

EXT_ENTRY="kililjbikhljfpjibnpnmjhdkapkfimm;https://entremaxmedia.github.io/creativeai_studio/updates.xml"

echo "Installing Creative AI extension policy for Vivaldi..."
echo "Your administrator password is required."
echo ""

sudo python3 -c "
import plistlib, os

entry = '$EXT_ENTRY'
pref_dir = '/Library/Managed Preferences'
plist_path = os.path.join(pref_dir, 'com.vivaldi.Vivaldi.plist')

os.makedirs(pref_dir, exist_ok=True)

if os.path.exists(plist_path):
    with open(plist_path, 'rb') as f:
        data = plistlib.load(f)
else:
    data = {}

entries = data.get('ExtensionInstallForcelist', [])
if entry not in entries:
    entries.append(entry)
data['ExtensionInstallForcelist'] = entries

with open(plist_path, 'wb') as f:
    plistlib.dump(data, f)

print('Policy written to', plist_path)
"

echo ""
echo "Done! Quit Vivaldi completely and reopen it."
echo "The Creative AI extension will install automatically within a minute."
