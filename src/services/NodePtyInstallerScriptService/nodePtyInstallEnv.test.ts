import { getNodePrebuildModulesFromEmbeddedNodeVersion } from './nodePtyInstallEnv';

describe('getNodePrebuildModulesFromEmbeddedNodeVersion', () => {
  it('maps embedded Node 19.x to ABI 111', () => {
    expect(getNodePrebuildModulesFromEmbeddedNodeVersion('19.2.0')).toBe('111');
  });

  it('maps embedded Node 20.x to ABI 115', () => {
    expect(getNodePrebuildModulesFromEmbeddedNodeVersion('20.18.1')).toBe('115');
  });

  it('accepts leading v', () => {
    expect(getNodePrebuildModulesFromEmbeddedNodeVersion('v20.0.1')).toBe('115');
  });
});
