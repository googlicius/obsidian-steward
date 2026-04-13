import { parseStewardInstallerMeta } from './NodePtyInstallerScriptService';

describe('parseStewardInstallerMeta', () => {
  it('parses plugin-version and template from steward meta line', () => {
    const content = `#!/usr/bin/env bash
# steward-installer-meta: plugin-version=2.6.0 template=1 prebuilt-pkg=0.13.1
set -e
`;
    expect(parseStewardInstallerMeta(content)).toEqual({
      pluginVersion: '2.6.0',
      templateVersion: '1',
    });
  });

  it('returns nulls when meta is missing', () => {
    expect(parseStewardInstallerMeta('# just a comment\n')).toEqual({
      pluginVersion: null,
      templateVersion: null,
    });
  });
});
