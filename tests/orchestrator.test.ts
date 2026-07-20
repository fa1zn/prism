import { describe, expect, it } from 'vitest';

import { TaskQueue } from '../src/core/orchestrator.js';

interface T {
  id: string;
}

describe('TaskQueue drain semantics', () => {
  it('drains seed tasks then returns null once all are done', async () => {
    const q = new TaskQueue<T>([{ id: 'a' }, { id: 'b' }]);

    const a = await q.next();
    const b = await q.next();
    expect([a?.id, b?.id]).toEqual(['a', 'b']);

    q.done();
    q.done();
    expect(await q.next()).toBeNull();
  });

  it('does not report drained while a task is still in flight, and picks up fan-out work', async () => {
    const q = new TaskQueue<T>([{ id: 'a' }]);

    const a = await q.next(); // inFlight = 1, queue empty
    expect(a?.id).toBe('a');

    // A second worker asks for work while the queue is momentarily empty but the
    // first task is still running. It must wait, not exit.
    const pending = q.next();
    q.add({ id: 'b' }); // the in-flight task produces a follow-up

    const b = await pending;
    expect(b?.id).toBe('b');

    q.done();
    q.done();
    expect(await q.next()).toBeNull();
  });

  it('returns null immediately when seeded empty', async () => {
    const q = new TaskQueue<T>([]);
    expect(await q.next()).toBeNull();
  });
});
