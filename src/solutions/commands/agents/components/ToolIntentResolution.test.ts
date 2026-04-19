jest.mock('../agentTools', () => {
  const keys = [
    'list',
    'create',
    'delete',
    'copy',
    'move',
    'rename',
    'edit',
    'content_reading',
    'todo_write',
    'confirmation',
    'ask_user',
    'switch_agent_capacity',
    'activate_tools',
    'conclude',
    'recall_compacted_context',
  ] as const;
  return {
    SUPER_AGENT_TOOL_NAMES: new Set(keys),
    loadSuperAgentToolsBase: async () => ({}),
  };
});

import { ToolName } from '../../ToolRegistry';
import { SUPER_AGENT_TOOL_NAMES } from '../agentTools';
import { ToolIntentResolution } from './ToolIntentResolution';

const MOCK_SUPER_VALID = SUPER_AGENT_TOOL_NAMES;

const ALL_SUPER_KEYS: ToolName[] = [
  ToolName.LIST,
  ToolName.CREATE,
  ToolName.DELETE,
  ToolName.COPY,
  ToolName.MOVE,
  ToolName.RENAME,
  ToolName.EDIT,
  ToolName.CONTENT_READING,
  ToolName.TODO_WRITE,
  ToolName.CONFIRMATION,
  ToolName.ASK_USER,
  ToolName.SWITCH_AGENT_CAPACITY,
  ToolName.ACTIVATE,
  ToolName.CONCLUDE,
  ToolName.RECALL_COMPACTED_CONTEXT,
];

describe('ToolIntentResolution', () => {
  describe('normalizeDeclaredTools', () => {
    let sut: ToolIntentResolution;
    let normalizeDeclaredTools: ToolIntentResolution['normalizeDeclaredTools'];

    beforeEach(() => {
      sut = new ToolIntentResolution();
      normalizeDeclaredTools = sut['normalizeDeclaredTools'].bind(sut);
    });

    it('returns null for undefined, empty, or all invalid', () => {
      expect(normalizeDeclaredTools(undefined, MOCK_SUPER_VALID)).toBeNull();
      expect(normalizeDeclaredTools([], MOCK_SUPER_VALID)).toBeNull();
      expect(normalizeDeclaredTools(['not_a_tool' as ToolName], MOCK_SUPER_VALID)).toBeNull();
    });

    it('deduplicates and keeps order of first occurrence', () => {
      expect(
        normalizeDeclaredTools([ToolName.LIST, ToolName.LIST, ToolName.EDIT], MOCK_SUPER_VALID)
      ).toEqual([ToolName.LIST, ToolName.EDIT]);
    });
  });

  describe('expandSuperAgentDeclaredTools', () => {
    let sut: ToolIntentResolution;
    let expandSuperAgentDeclaredTools: ToolIntentResolution['expandSuperAgentDeclaredTools'];

    beforeEach(() => {
      sut = new ToolIntentResolution();
      expandSuperAgentDeclaredTools = sut['expandSuperAgentDeclaredTools'].bind(sut);
    });

    it('returns empty array when declared is null', () => {
      expect(expandSuperAgentDeclaredTools(null)).toEqual([]);
    });

    it('adds switch_agent_capacity when declared length is <= threshold and switch missing', () => {
      const expanded = expandSuperAgentDeclaredTools([ToolName.LIST]);
      expect(expanded).toContain(ToolName.LIST);
      expect(expanded).toContain(ToolName.SWITCH_AGENT_CAPACITY);
      expect(expanded.length).toBe(2);
    });

    it('does not duplicate switch_agent_capacity when already declared', () => {
      expect(expandSuperAgentDeclaredTools([ToolName.SWITCH_AGENT_CAPACITY])).toEqual([
        ToolName.SWITCH_AGENT_CAPACITY,
      ]);
    });

    it('adds activate_tools when declared length > threshold', () => {
      const six = [
        ToolName.LIST,
        ToolName.CREATE,
        ToolName.DELETE,
        ToolName.COPY,
        ToolName.MOVE,
        ToolName.RENAME,
      ];
      const expanded = expandSuperAgentDeclaredTools(six);
      expect(expanded).toContain(ToolName.ACTIVATE);
      expect(expanded).not.toContain(ToolName.SWITCH_AGENT_CAPACITY);
    });
  });

  describe('buildSuperAgentEffectiveAllowedNames', () => {
    let sut: ToolIntentResolution;
    let expandSuperAgentDeclaredTools: ToolIntentResolution['expandSuperAgentDeclaredTools'];
    let buildSuperAgentEffectiveAllowedNames: ToolIntentResolution['buildSuperAgentEffectiveAllowedNames'];

    beforeEach(() => {
      sut = new ToolIntentResolution();
      expandSuperAgentDeclaredTools = sut['expandSuperAgentDeclaredTools'].bind(sut);
      buildSuperAgentEffectiveAllowedNames = sut['buildSuperAgentEffectiveAllowedNames'].bind(sut);
    });

    it('excludes switch_agent_capacity when full tool set (declared null)', () => {
      const names = buildSuperAgentEffectiveAllowedNames({
        declaredNormalized: null,
        expandedDeclared: [],
        conversationActiveTools: [],
        allToolKeys: ALL_SUPER_KEYS,
        toolsThatEnableConclude: new Set([ToolName.EDIT]),
        hasConcludeEligibleDeclaredTool: false,
        hasCompactionContext: false,
      });
      expect(names).not.toContain(ToolName.SWITCH_AGENT_CAPACITY);
      expect(names).toContain(ToolName.LIST);
      expect(names.length).toBe(ALL_SUPER_KEYS.length - 1);
    });

    it('merges conversation active tools into effective allowed (UDC pre-activated tools)', () => {
      const declared = [ToolName.CONTENT_READING, ToolName.SWITCH_AGENT_CAPACITY];
      const expanded = expandSuperAgentDeclaredTools(declared);
      const names = buildSuperAgentEffectiveAllowedNames({
        declaredNormalized: declared,
        expandedDeclared: expanded,
        conversationActiveTools: [ToolName.TODO_WRITE, ToolName.CONFIRMATION, ToolName.ASK_USER],
        allToolKeys: ALL_SUPER_KEYS,
        toolsThatEnableConclude: new Set(),
        hasConcludeEligibleDeclaredTool: false,
        hasCompactionContext: false,
      });
      expect(names).toContain(ToolName.CONTENT_READING);
      expect(names).toContain(ToolName.SWITCH_AGENT_CAPACITY);
      expect(names).toContain(ToolName.TODO_WRITE);
      expect(names).toContain(ToolName.CONFIRMATION);
      expect(names).toContain(ToolName.ASK_USER);
    });

    it('ignores conversation active tools not present in allToolKeys', () => {
      const declared = [ToolName.LIST];
      const expanded = expandSuperAgentDeclaredTools(declared);
      const names = buildSuperAgentEffectiveAllowedNames({
        declaredNormalized: declared,
        expandedDeclared: expanded,
        conversationActiveTools: [ToolName.CREATE, ToolName.TODO_WRITE],
        allToolKeys: [ToolName.LIST, ToolName.EDIT, ToolName.SWITCH_AGENT_CAPACITY] as ToolName[],
        toolsThatEnableConclude: new Set(),
        hasConcludeEligibleDeclaredTool: false,
        hasCompactionContext: false,
      });
      expect(names).toContain(ToolName.LIST);
      expect(names).toContain(ToolName.SWITCH_AGENT_CAPACITY);
      expect(names).not.toContain(ToolName.CREATE);
      expect(names).not.toContain(ToolName.TODO_WRITE);
    });
  });

  describe('resolveStreamActiveToolNames', () => {
    let sut: ToolIntentResolution;
    let expandSuperAgentDeclaredTools: ToolIntentResolution['expandSuperAgentDeclaredTools'];
    let buildSuperAgentEffectiveAllowedNames: ToolIntentResolution['buildSuperAgentEffectiveAllowedNames'];
    let resolveStreamActiveToolNames: ToolIntentResolution['resolveStreamActiveToolNames'];

    beforeEach(() => {
      sut = new ToolIntentResolution();
      expandSuperAgentDeclaredTools = sut['expandSuperAgentDeclaredTools'].bind(sut);
      buildSuperAgentEffectiveAllowedNames = sut['buildSuperAgentEffectiveAllowedNames'].bind(sut);
      resolveStreamActiveToolNames = sut['resolveStreamActiveToolNames'].bind(sut);
    });

    it('uses all effective tools when original declared count <= threshold (even if expanded grew)', () => {
      const declared = [
        ToolName.LIST,
        ToolName.CREATE,
        ToolName.DELETE,
        ToolName.COPY,
        ToolName.RENAME,
      ];
      const expanded = expandSuperAgentDeclaredTools(declared);
      expect(expanded.length).toBeGreaterThan(5);
      const effective = new Set(
        buildSuperAgentEffectiveAllowedNames({
          declaredNormalized: declared,
          expandedDeclared: expanded,
          conversationActiveTools: [],
          allToolKeys: ALL_SUPER_KEYS,
          toolsThatEnableConclude: new Set(),
          hasConcludeEligibleDeclaredTool: false,
          hasCompactionContext: false,
        })
      );
      const active = resolveStreamActiveToolNames({
        declaredNormalized: declared,
        expandedDeclared: expanded,
        effectiveAllowed: effective,
        conversationActiveTools: [],
        toolsThatEnableConclude: new Set(),
        hasCompactionContext: false,
      });
      expect([...active].sort()).toEqual([...effective].sort());
    });

    it('returns only switch for switch-only expanded set', () => {
      const expanded = [ToolName.SWITCH_AGENT_CAPACITY];
      const effective = new Set(expanded);
      const active = resolveStreamActiveToolNames({
        declaredNormalized: expanded,
        expandedDeclared: expanded,
        effectiveAllowed: effective,
        conversationActiveTools: [],
        toolsThatEnableConclude: new Set(),
        hasCompactionContext: false,
      });
      expect(active).toEqual([ToolName.SWITCH_AGENT_CAPACITY]);
    });

    it('keeps pre-activated tools in stream active list for small UDC-declared sets', () => {
      const declared = [ToolName.CONTENT_READING, ToolName.SWITCH_AGENT_CAPACITY];
      const expanded = expandSuperAgentDeclaredTools(declared);
      const effective = new Set(
        buildSuperAgentEffectiveAllowedNames({
          declaredNormalized: declared,
          expandedDeclared: expanded,
          conversationActiveTools: [ToolName.TODO_WRITE, ToolName.CONFIRMATION, ToolName.ASK_USER],
          allToolKeys: ALL_SUPER_KEYS,
          toolsThatEnableConclude: new Set(),
          hasConcludeEligibleDeclaredTool: false,
          hasCompactionContext: false,
        })
      );
      const active = resolveStreamActiveToolNames({
        declaredNormalized: declared,
        expandedDeclared: expanded,
        effectiveAllowed: effective,
        conversationActiveTools: [ToolName.TODO_WRITE, ToolName.CONFIRMATION, ToolName.ASK_USER],
        toolsThatEnableConclude: new Set(),
        hasCompactionContext: false,
      });
      expect([...active].sort()).toEqual([...effective].sort());
      expect(active).toContain(ToolName.TODO_WRITE);
    });
  });

  describe('expandSubagentDeclaredTools', () => {
    let sut: ToolIntentResolution;
    let expandSubagentDeclaredTools: ToolIntentResolution['expandSubagentDeclaredTools'];

    beforeEach(() => {
      sut = new ToolIntentResolution();
      expandSubagentDeclaredTools = sut['expandSubagentDeclaredTools'].bind(sut);
    });

    it('only adds activate_tools for large sets', () => {
      expect(expandSubagentDeclaredTools(null)).toEqual([]);
      const small = [ToolName.LIST, ToolName.EDIT];
      expect(expandSubagentDeclaredTools(small)).toEqual(small);
      const six = [
        ToolName.LIST,
        ToolName.CREATE,
        ToolName.DELETE,
        ToolName.COPY,
        ToolName.MOVE,
        ToolName.RENAME,
      ];
      expect(expandSubagentDeclaredTools(six)).toContain(ToolName.ACTIVATE);
    });
  });
});
