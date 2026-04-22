// ============================================================
// NeuroSustain — Object Pool Utility
// Enforces the "Zero-Allocation" architectural rule by pre-instantiating
// objects to prevent V8 Garbage Collection (GC) stutters during trials.
// ============================================================

export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;

  /**
   * @param factory Function that returns a new instance of T
   * @param initialSize Number of instances to pre-allocate
   */
  constructor(factory: () => T, initialSize: number) {
    this.factory = factory;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  /**
   * Retrieves an instance from the pool.
   * If the pool is empty, it expands by allocating a new one (should rarely happen).
   */
  acquire(): T {
    return this.pool.length > 0 ? this.pool.pop()! : this.factory();
  }

  /**
   * Returns an instance back to the pool.
   * NOTE: The caller should reset the object's properties to their defaults
   * before or immediately after releasing it.
   */
  release(item: T): void {
    this.pool.push(item);
  }

  /**
   * Empties the pool completely.
   */
  clear(): void {
    this.pool = [];
  }
}
