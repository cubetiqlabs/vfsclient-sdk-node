import { describe, expect, it } from 'bun:test';
import { VFSClient, canonicalSoftwareJSON, signSoftwarePayload, softwareKeyPairFromSeed, verifySoftwarePayload } from '../src';
import type { ReleasePayload, SoftwareManifest } from '../src/software/types';
import { mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openUploadSource } from '../src/upload/source';

const seed = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const keyId = '56475aa75463474c0285df5dbf2bcab73da651358839e9b77481b2eab107708c';
const publicKey = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';
const signature = 'Uts4UvpoxM8jBg_BeTxePyN-pc-n1NNSGqQtCCT5iuDuMt6_ohfGooZHSwSTWsRdZkZFMinFHFLsb0ryvifvDw';

function fixturePayload(): ReleasePayload {
  return { schema_version: 1, bucket_id: 'desktop', app: 'my-app', version: '1.2.3', assets: [{ os: 'windows', arch: 'x64', kind: 'installer', filename: 'app.exe', file_id: 'abc123', sha256: 'a'.repeat(64), size: 42, download_path: '/v/desktop/abc123' }] };
}

describe('software signatures', () => {
  it('matches the Go RFC 8785 and Ed25519 fixture and rejects tampering', () => {
    const payload = fixturePayload();
    expect(softwareKeyPairFromSeed(seed)).toEqual({ publicKey, keyId });
    expect(canonicalSoftwareJSON(payload)).toBe(`{"app":"my-app","assets":[{"arch":"x64","download_path":"/v/desktop/abc123","file_id":"abc123","filename":"app.exe","kind":"installer","os":"windows","sha256":"${'a'.repeat(64)}","size":42}],"bucket_id":"desktop","schema_version":1,"version":"1.2.3"}`);
    expect(signSoftwarePayload(payload, seed)).toEqual({ key_id: keyId, value: signature });
    expect(() => verifySoftwarePayload(payload, { key_id: keyId, value: signature }, { [keyId]: publicKey })).not.toThrow();
    payload.assets[0]!.size++;
    expect(() => verifySoftwarePayload(payload, { key_id: keyId, value: signature }, { [keyId]: publicKey })).toThrow();
  });

  it('selects the signed target, skips downgrades and rejects changed bytes', async () => {
    const bytes = new TextEncoder().encode('abc');
    const payload: ReleasePayload = { ...fixturePayload(), assets: [{ ...fixturePayload().assets[0]!, size: bytes.length, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }] };
    const headPayload = { schema_version: 1 as const, bucket_id: 'desktop', app: 'my-app', channel: 'stable', revision: 1, mode: 'promote' as const, latest: { 'windows/x64': '1.2.3' } };
    const release = { payload, signature: signSoftwarePayload(payload, seed), digest: '', published_at: new Date().toISOString(), revoked: false };
    const manifest: SoftwareManifest = { schema_version: 1, application: { bucket_id: 'desktop', app: 'my-app', name: 'My App', keys: [], active_key_id: keyId, created_at: '', updated_at: '' }, channel: 'stable', head: { payload: headPayload, signature: signSoftwarePayload(headPayload, seed), updated_at: '' }, latest_releases: [release], releases: [release] };
    let corrupt = false;
    const fetcher: typeof fetch = async (url) => String(url).includes('manifest.json')
      ? new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
      : new Response(corrupt ? 'abd' : bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
    const client = new VFSClient({ endpoint: 'https://vfs.example.test', fetch: fetcher });
    const input = { bucketId: 'desktop', app: 'my-app', os: 'windows', arch: 'x64', trustedKeys: { [keyId]: publicKey } };
    expect(await client.software.checkForUpdate({ ...input, currentVersion: '1.2.4' })).toBeNull();
    const update = await client.software.checkForUpdate({ ...input, currentVersion: '1.2.2' });
    expect(update?.release.payload.version).toBe('1.2.3');
    expect(await client.software.downloadAndVerify(update!.assets[0]!)).toEqual(bytes);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vfs-download-test-'));
    try {
      const destination = path.join(directory, 'verified.bin');
      await client.software.downloadToFile(update!.assets[0]!, destination);
      expect(await readFile(destination, 'utf8')).toBe('abc');
      corrupt = true;
      await expect(client.software.downloadToFile(update!.assets[0]!, path.join(directory, 'bad.bin'))).rejects.toThrow(/SHA-256/);
      expect(await readdir(directory)).toEqual(['verified.bin']);
    } finally { await rm(directory, { recursive: true, force: true }); }
    corrupt = true;
    await expect(client.software.downloadAndVerify(update!.assets[0]!)).rejects.toThrow(/SHA-256/);
    manifest.head!.payload.latest['windows/x64'] = '9.9.9';
    await expect(client.software.checkForUpdate(input)).rejects.toThrow(/signature/i);
  });
});

describe('large artifact sources', () => {
  it('reads file-path chunks and uploads through a stream body', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vfs-source-test-'));
    const file = path.join(directory, 'artifact.bin');
    const handle = await open(file, 'w');
    await handle.truncate(128 * 1024 * 1024);
    await handle.close();
    try {
      const source = await openUploadSource({ file });
      expect(source.size).toBe(128 * 1024 * 1024);
      expect((await source.read(128, 1024)).length).toBe(1024);
      await source.close();
      let streamSeen = false;
      const fetcher: typeof fetch = async (_url, init) => {
        streamSeen = init?.body instanceof ReadableStream;
        expect(init?.method).toBe('PUT');
        return new Response(JSON.stringify({ file_id: 'abc', file_hash: source.hash, size: source.size }), { headers: { 'Content-Type': 'application/json' } });
      };
      const client = new VFSClient({ endpoint: 'https://vfs.example.test', fetch: fetcher });
      await client.upload({ file, bucketId: 'desktop', preflight: false });
      expect(streamSeen).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('platform auto-detection', () => {
  it('correctly classifies windows binaries', async () => {
    const { detectAssetPlatform } = await import('../src');
    expect(detectAssetPlatform('my-app-setup-x64.exe')).toEqual({ os: 'windows', arch: 'x64', kind: 'installer' });
    expect(detectAssetPlatform('my-app-arm64.msi')).toEqual({ os: 'windows', arch: 'arm64', kind: 'installer' });
    expect(detectAssetPlatform('my-app-windows-x64.zip')).toEqual({ os: 'windows', arch: 'x64', kind: 'archive' });
  });

  it('correctly classifies macOS binaries', async () => {
    const { detectAssetPlatform } = await import('../src');
    expect(detectAssetPlatform('my-app-darwin-arm64.dmg')).toEqual({ os: 'darwin', arch: 'arm64', kind: 'installer' });
    expect(detectAssetPlatform('my-app-mac-universal.pkg')).toEqual({ os: 'darwin', arch: 'universal', kind: 'installer' });
    expect(detectAssetPlatform('my-app-osx-x64.tar.gz')).toEqual({ os: 'darwin', arch: 'x64', kind: 'archive' });
  });

  it('correctly classifies linux and android binaries', async () => {
    const { detectAssetPlatform } = await import('../src');
    expect(detectAssetPlatform('my-app-linux-amd64.deb')).toEqual({ os: 'linux', arch: 'x64', kind: 'package' });
    expect(detectAssetPlatform('my-app-aarch64.AppImage')).toEqual({ os: 'linux', arch: 'arm64', kind: 'installer' });
    expect(detectAssetPlatform('my-app-android-arm64-v8a.apk')).toEqual({ os: 'android', arch: 'arm64', kind: 'package' });
    expect(detectAssetPlatform('checksums.sha256')).toEqual({ os: 'universal', arch: 'x64', kind: 'checksum' });
  });
});

describe('SemVer version suggestions', () => {
  it('suggests initial versions when no versions exist', async () => {
    const { suggestNextVersions } = await import('../src');
    const suggestions = suggestNextVersions([]);
    expect(suggestions.current).toBeNull();
    expect(suggestions.patch).toBe('0.1.0');
    expect(suggestions.minor).toBe('0.2.0');
    expect(suggestions.major).toBe('1.0.0');
  });

  it('suggests patch, minor, major, and prerelease versions accurately', async () => {
    const { suggestNextVersions } = await import('../src');
    const suggestions = suggestNextVersions(['1.0.0', '1.2.3', '1.1.0']);
    expect(suggestions.current).toBe('1.2.3');
    expect(suggestions.patch).toBe('1.2.4');
    expect(suggestions.minor).toBe('1.3.0');
    expect(suggestions.major).toBe('2.0.0');
    expect(suggestions.prerelease.alpha).toBe('1.2.4-alpha.1');
    expect(suggestions.prerelease.beta).toBe('1.2.4-beta.1');
    expect(suggestions.prerelease.rc).toBe('1.2.4-rc.1');
  });
});

describe('signing key management and validation', () => {
  it('validates 32-byte base64url seeds and checks key id matching', async () => {
    const { validateSigningSeed } = await import('../src');
    const result = validateSigningSeed(seed, keyId);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(keyId);
    expect(result.publicKey).toBe(publicKey);
    expect(result.matches).toBe(true);

    const badMatch = validateSigningSeed(seed, 'wrong-key-id');
    expect(badMatch.valid).toBe(true);
    expect(badMatch.matches).toBe(false);

    const invalid = validateSigningSeed('not-32-bytes');
    expect(invalid.valid).toBe(false);
  });

  it('serializes and parses key files and env strings', async () => {
    const { createKeyFile, parseKeyFile } = await import('../src');
    const keyFile = createKeyFile(seed, 'my-app', 'desktop');
    expect(keyFile.vfs_key_version).toBe(1);
    expect(keyFile.app).toBe('my-app');
    expect(keyFile.key_id).toBe(keyId);

    const parsedJson = parseKeyFile(JSON.stringify(keyFile));
    expect(parsedJson.seed).toBe(seed);
    expect(parsedJson.app).toBe('my-app');

    const parsedEnv = parseKeyFile(`VFS_SIGNING_KEY="${seed}"`);
    expect(parsedEnv.seed).toBe(seed);

    const parsedRaw = parseKeyFile(seed);
    expect(parsedRaw.seed).toBe(seed);
  });
});

