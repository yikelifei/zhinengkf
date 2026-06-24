#!/usr/bin/env python3
import sys
import os
import tempfile
import zipfile
import shutil
import subprocess

def get_resource_path(name):
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(__file__)
    return os.path.join(base, name)

def main():
    zip_name = 'smart_bot_installer.zip'
    ps1_name = 'install.ps1'

    src_zip = get_resource_path(zip_name)
    src_ps1 = get_resource_path(ps1_name)

    if not os.path.exists(src_zip) or not os.path.exists(src_ps1):
        print('Required files missing:', src_zip, src_ps1)
        sys.exit(2)

    td = tempfile.mkdtemp(prefix='smartbot_install_')
    try:
        # copy files to temp
        zip_dst = os.path.join(td, zip_name)
        ps1_dst = os.path.join(td, ps1_name)
        shutil.copy2(src_zip, zip_dst)
        shutil.copy2(src_ps1, ps1_dst)

        # run PowerShell to execute the installer script
        cmd = [
            'powershell',
            '-ExecutionPolicy', 'Bypass',
            '-NoProfile',
            '-File', ps1_dst,
            '-ZipPath', zip_dst,
        ]
        print('Running:', ' '.join(cmd))
        proc = subprocess.run(cmd)
        sys.exit(proc.returncode)
    finally:
        try:
            shutil.rmtree(td)
        except Exception:
            pass

if __name__ == '__main__':
    main()
