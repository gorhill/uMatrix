#!/usr/bin/env python3

import os
import json
import re
import sys

if len(sys.argv) == 1 or not sys.argv[1]:
    raise SystemExit('Build dir missing.')

proj_dir = os.path.join(os.path.split(os.path.abspath(__file__))[0], '..')
build_dir = os.path.abspath(sys.argv[1])

version = ''
with open(os.path.join(proj_dir, 'dist', 'version')) as f:
    version = f.read().strip()

# Import data from chromium platform
chromium_manifest = {}
opera_manifest = {}

chromium_manifest_file = os.path.join(proj_dir, 'platform', 'chromium', 'manifest.json')
with open(chromium_manifest_file) as f1:
    chromium_manifest = json.load(f1)

# WebExtension
opera_manifest_add_file = os.path.join(proj_dir, 'platform', 'opera', 'manifest-add.json')
with open(opera_manifest_add_file) as f2:
    opera_manifest = json.load(f2)

for key in chromium_manifest:
    if key not in opera_manifest:
        opera_manifest[key] = chromium_manifest[key]

# Development build? If so, modify name accordingly.
match = re.search('^(\d+\.\d+\.\d+)(\.|b|rc)(\d+)$', version)
if match:
    version = match.group(1)
    revision = int(match.group(3))
    if match.group(2) == 'rc':
        revision += 100
    version += '.' + str(revision)
    opera_manifest['name'] += ' development build'
    opera_manifest['short_name'] += ' dev build'
    opera_manifest['browser_action']['default_title'] += ' dev build'

opera_manifest['version'] = version

opera_manifest_file = os.path.join(build_dir, 'manifest.json')
with open(opera_manifest_file, 'w') as f2:
    json.dump(opera_manifest, f2, indent=2, separators=(',', ': '), sort_keys=True)
    f2.write('\n')
