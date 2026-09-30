import type { DetectedPlatform } from './types';

/**
 * Automatically inspects a file name or path to detect OS, architecture, and asset kind.
 */
export function detectAssetPlatform(filename: string): DetectedPlatform {
  const name = filename.toLowerCase();

  // 1. Detect OS
  let os = '';
  if (name.endsWith('.exe') || name.endsWith('.msi') || name.endsWith('.msix') || name.endsWith('.appx') ||
      name.includes('windows') || name.includes('win32') || name.includes('win64') || name.includes('-win-') || name.includes('_win_') || name.includes('.win.')) {
    os = 'windows';
  } else if (name.endsWith('.dmg') || name.endsWith('.pkg') || name.includes('darwin') || name.includes('macos') ||
             name.includes('mac-') || name.includes('mac_') || name.includes('-mac.') || name.includes('osx') || name.includes('apple')) {
    os = 'darwin';
  } else if (name.endsWith('.deb') || name.endsWith('.rpm') || name.endsWith('.appimage') ||
             name.includes('linux') || name.includes('ubuntu') || name.includes('debian') || name.includes('centos') || name.includes('alpine') || name.includes('archlinux')) {
    os = 'linux';
  } else if (name.endsWith('.apk') || name.endsWith('.aab') || name.includes('android')) {
    os = 'android';
  } else {
    os = 'universal';
  }

  // 2. Detect Architecture
  let arch = '';
  if (name.includes('arm64') || name.includes('aarch64') || name.includes('arm64-v8a')) {
    arch = 'arm64';
  } else if (name.includes('x86_64') || name.includes('amd64') || name.includes('x64') || name.includes('win64') || name.includes('64bit')) {
    arch = 'x64';
  } else if (name.includes('armv7') || name.includes('armv7l') || name.includes('armeabi-v7a') || name.includes('armhf') || name.includes('arm32')) {
    arch = 'arm';
  } else if (name.includes('i386') || name.includes('i686') || name.includes('x86') || name.includes('win32') || name.includes('32bit')) {
    arch = 'x86';
  } else if (name.includes('universal') || name.includes('fat') || name.includes('all')) {
    arch = 'universal';
  } else {
    // Sensible defaults based on OS and extension
    if (os === 'android') {
      arch = 'arm64';
    } else if (os === 'darwin' && name.endsWith('.dmg')) {
      arch = 'universal';
    } else {
      arch = 'x64';
    }
  }

  // 3. Detect Kind
  let kind = 'binary';
  if (name.endsWith('.exe') || name.endsWith('.msi') || name.endsWith('.dmg') || name.endsWith('.pkg') || name.endsWith('.appimage')) {
    kind = 'installer';
  } else if (name.endsWith('.deb') || name.endsWith('.rpm') || name.endsWith('.apk') || name.endsWith('.aab') || name.endsWith('.msix') || name.endsWith('.appx')) {
    kind = 'package';
  } else if (name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.tar.xz') || name.endsWith('.tar.bz2') || name.endsWith('.7z')) {
    kind = 'archive';
  } else if (name.endsWith('.sha256') || name.endsWith('.sha512') || name.endsWith('.md5') || name.includes('checksum')) {
    kind = 'checksum';
  } else if (name.endsWith('.sig') || name.endsWith('.asc') || name.endsWith('.minisig')) {
    kind = 'signature';
  }

  return { os, arch, kind };
}
