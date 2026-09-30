import semver from 'semver';
import type { VersionSuggestions } from './types';

/**
 * Computes the highest current SemVer version and suggests next versions
 * for patch, minor, major, and prerelease channels.
 */
export function suggestNextVersions(versions: string[], currentOverride?: string): VersionSuggestions {
  let highest: string | null = null;

  if (currentOverride && semver.valid(currentOverride)) {
    highest = semver.clean(currentOverride);
  } else {
    for (const v of versions) {
      const clean = semver.clean(v.replace(/^v/, ''));
      if (clean && (!highest || semver.gt(clean, highest))) {
        highest = clean;
      }
    }
  }

  if (!highest) {
    return {
      current: null,
      patch: '0.1.0',
      minor: '0.2.0',
      major: '1.0.0',
      prerelease: {
        alpha: '0.1.0-alpha.1',
        beta: '0.1.0-beta.1',
        rc: '0.1.0-rc.1',
      },
    };
  }

  const patch = semver.inc(highest, 'patch') || `${highest}-patch`;
  const minor = semver.inc(highest, 'minor') || `${highest}-minor`;
  const major = semver.inc(highest, 'major') || `${highest}-major`;

  // If highest is already a prerelease (e.g. 1.2.3-alpha.1), next prerelease advances it
  const isPrerelease = semver.prerelease(highest) !== null;
  const alpha = isPrerelease
    ? (semver.inc(highest, 'prerelease', 'alpha') || `${highest}.alpha.1`)
    : `${patch}-alpha.1`;
  const beta = isPrerelease
    ? (semver.inc(highest, 'prerelease', 'beta') || `${highest}.beta.1`)
    : `${patch}-beta.1`;
  const rc = isPrerelease
    ? (semver.inc(highest, 'prerelease', 'rc') || `${highest}.rc.1`)
    : `${patch}-rc.1`;

  return {
    current: highest,
    patch,
    minor,
    major,
    prerelease: {
      alpha,
      beta,
      rc,
    },
  };
}
