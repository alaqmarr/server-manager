import { TestResult, SuiteSummary } from './types';

export class AssertionError extends Error {
  public actual: any;
  public expected: any;

  constructor(message: string, actual?: any, expected?: any) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

class AssertionContext {
  public static assertionCount = 0;

  public static record() {
    this.assertionCount++;
  }

  public static resetCount(): number {
    const prev = this.assertionCount;
    this.assertionCount = 0;
    return prev;
  }
}

export function expect(actual: any) {
  return {
    toBe(expected: any, customMsg?: string) {
      AssertionContext.record();
      if (actual !== expected) {
        throw new AssertionError(
          customMsg || `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`,
          actual,
          expected
        );
      }
    },

    toEqual(expected: any, customMsg?: string) {
      AssertionContext.record();
      const actualJson = JSON.stringify(actual);
      const expectedJson = JSON.stringify(expected);
      if (actualJson !== expectedJson) {
        throw new AssertionError(
          customMsg || `Expected ${actualJson} to deeply equal ${expectedJson}`,
          actual,
          expected
        );
      }
    },

    toBeTruthy(customMsg?: string) {
      AssertionContext.record();
      if (!actual) {
        throw new AssertionError(
          customMsg || `Expected truthy value, got ${JSON.stringify(actual)}`,
          actual,
          true
        );
      }
    },

    toBeFalsy(customMsg?: string) {
      AssertionContext.record();
      if (actual) {
        throw new AssertionError(
          customMsg || `Expected falsy value, got ${JSON.stringify(actual)}`,
          actual,
          false
        );
      }
    },

    toBeDefined(customMsg?: string) {
      AssertionContext.record();
      if (actual === undefined || actual === null) {
        throw new AssertionError(
          customMsg || `Expected value to be defined, got ${actual}`,
          actual,
          'defined'
        );
      }
    },

    toBeGreaterThan(num: number, customMsg?: string) {
      AssertionContext.record();
      if (typeof actual !== 'number' || !(actual > num)) {
        throw new AssertionError(
          customMsg || `Expected ${actual} > ${num}`,
          actual,
          num
        );
      }
    },

    toBeGreaterThanOrEqual(num: number, customMsg?: string) {
      AssertionContext.record();
      if (typeof actual !== 'number' || !(actual >= num)) {
        throw new AssertionError(
          customMsg || `Expected ${actual} >= ${num}`,
          actual,
          num
        );
      }
    },

    toBeLessThan(num: number, customMsg?: string) {
      AssertionContext.record();
      if (typeof actual !== 'number' || !(actual < num)) {
        throw new AssertionError(
          customMsg || `Expected ${actual} < ${num}`,
          actual,
          num
        );
      }
    },

    toBeLessThanOrEqual(num: number, customMsg?: string) {
      AssertionContext.record();
      if (typeof actual !== 'number' || !(actual <= num)) {
        throw new AssertionError(
          customMsg || `Expected ${actual} <= ${num}`,
          actual,
          num
        );
      }
    },

    toContain(item: any, customMsg?: string) {
      AssertionContext.record();
      if (typeof actual === 'string') {
        if (!actual.includes(String(item))) {
          throw new AssertionError(
            customMsg || `Expected string "${actual}" to contain "${item}"`,
            actual,
            item
          );
        }
      } else if (Array.isArray(actual)) {
        if (!actual.includes(item)) {
          throw new AssertionError(
            customMsg || `Expected array to contain ${JSON.stringify(item)}`,
            actual,
            item
          );
        }
      } else {
        throw new AssertionError(
          customMsg || `Cannot check contains on non-string/array type: ${typeof actual}`,
          actual,
          item
        );
      }
    },

    toMatch(pattern: RegExp, customMsg?: string) {
      AssertionContext.record();
      if (typeof actual !== 'string' || !pattern.test(actual)) {
        throw new AssertionError(
          customMsg || `Expected "${actual}" to match pattern ${pattern.toString()}`,
          actual,
          pattern.toString()
        );
      }
    },

    toBeOneOf(allowed: any[], customMsg?: string) {
      AssertionContext.record();
      if (!allowed.includes(actual)) {
        throw new AssertionError(
          customMsg || `Expected ${JSON.stringify(actual)} to be one of ${JSON.stringify(allowed)}`,
          actual,
          allowed
        );
      }
    },
  };
}

export type TestCaseFn = () => Promise<void> | void;

export interface RegisteredCase {
  suite: string;
  name: string;
  fn: TestCaseFn;
}

export class TestSuiteCollector {
  private cases: RegisteredCase[] = [];
  private currentSuite = 'General';

  public describe(suiteName: string, fn: () => void): void {
    const prev = this.currentSuite;
    this.currentSuite = suiteName;
    try {
      fn();
    } finally {
      this.currentSuite = prev;
    }
  }

  public test(name: string, fn: TestCaseFn): void {
    this.cases.push({
      suite: this.currentSuite,
      name,
      fn,
    });
  }

  public it(name: string, fn: TestCaseFn): void {
    this.test(name, fn);
  }

  public getCases(): RegisteredCase[] {
    return [...this.cases];
  }

  public clear(): void {
    this.cases = [];
  }

  public async runAll(options: { bail?: boolean; verbose?: boolean } = {}): Promise<SuiteSummary> {
    const results: TestResult[] = [];
    const suiteStart = Date.now();
    let passed = 0;
    let failed = 0;

    for (const c of this.cases) {
      AssertionContext.resetCount();
      const start = Date.now();
      try {
        await c.fn();
        const duration = Date.now() - start;
        const assertions = AssertionContext.resetCount();
        passed++;
        const res: TestResult = {
          suite: c.suite,
          name: c.name,
          passed: true,
          durationMs: duration,
          assertionCount: Math.max(assertions, 1),
        };
        results.push(res);
        if (options.verbose) {
          console.log(`  \x1b[32m✔\x1b[0m [${c.suite}] ${c.name} (${duration}ms, ${res.assertionCount} assertions)`);
        }
      } catch (err: any) {
        const duration = Date.now() - start;
        const assertions = AssertionContext.resetCount();
        failed++;
        const errMsg = err?.stack || err?.message || String(err);
        const res: TestResult = {
          suite: c.suite,
          name: c.name,
          passed: false,
          durationMs: duration,
          error: errMsg,
          assertionCount: assertions,
        };
        results.push(res);
        if (options.verbose) {
          console.log(`  \x1b[31m✖\x1b[0m [${c.suite}] ${c.name} (${duration}ms)`);
          console.log(`    \x1b[31mError: ${err?.message || err}\x1b[0m`);
        }
        if (options.bail) {
          break;
        }
      }
    }

    return {
      suiteName: this.currentSuite,
      total: this.cases.length,
      passed,
      failed,
      durationMs: Date.now() - suiteStart,
      results,
    };
  }
}
