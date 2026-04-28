import { AbortOperationKeys } from 'src/constants';
import { AbortService } from './AbortService';

describe('AbortService', () => {
  let service: AbortService;

  beforeEach(() => {
    service = AbortService.getInstance();
    service.abortAllOperations();
  });

  it('scopes createAbortController by conversationTitle and replaces same operationKey', () => {
    const a = service.createAbortController('conv-a', AbortOperationKeys.SUPER_AGENT);
    const b = service.createAbortController('conv-b', AbortOperationKeys.SUPER_AGENT);
    expect(a.aborted).toBe(false);
    expect(b.aborted).toBe(false);
    expect(service.getActiveOperationsCount('conv-a')).toBe(1);
    expect(service.getActiveOperationsCount('conv-b')).toBe(1);

    const a2 = service.createAbortController('conv-a', AbortOperationKeys.SUPER_AGENT);
    expect(a.aborted).toBe(true);
    expect(a2.aborted).toBe(false);
    expect(b.aborted).toBe(false);
  });

  it('abortConversation removes only one note', () => {
    service.createAbortController('conv-a', AbortOperationKeys.SUPER_AGENT);
    service.createAbortController('conv-b', AbortOperationKeys.COMPACTION_SUMMARY);
    expect(service.abortConversation('conv-a')).toBe(1);
    expect(service.getActiveOperationsCount()).toBe(1);
    expect(service.getActiveOperationsCount('conv-b')).toBe(1);
  });

  it('abortAllOperations clears every scope', () => {
    service.createAbortController('c1', 'op1');
    service.createAbortController('c2', 'op2');
    expect(service.getActiveOperationsCount()).toBe(2);
    service.abortAllOperations();
    expect(service.getActiveOperationsCount()).toBe(0);
  });

  it('omitting operationKey allocates unique entries', () => {
    service.createAbortController('conv');
    service.createAbortController('conv');
    expect(service.getActiveOperationsCount('conv')).toBe(2);
  });
});
