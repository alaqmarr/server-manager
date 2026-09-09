/**
 * Enterprise Tiers Test Suite (Tiers 1-4)
 * Consolidates all enterprise test registrations across:
 * - Tier 1: Feature Tests (RBAC, Webhooks, Discord, SSE, Vitals, Fail2Ban, Uptime)
 * - Tier 2: Boundary, Negative & Adversarial Tests
 * - Tier 3: Cross-Feature Combinations & Multi-Role Pairwise Tests
 * - Tier 4: Real-World Workloads & Complex Operational Lifecycles
 */

import { TestClient } from './client';
import { TestSuiteCollector } from './test-framework';
import { registerEnterpriseTier1Tests } from './enterprise-tier1.test';
import { registerEnterpriseTier2Tests } from './enterprise-tier2.test';
import { registerEnterpriseTier3Tests } from './enterprise-tier3.test';
import { registerEnterpriseTier4Tests } from './enterprise-tier4.test';

export {
  registerEnterpriseTier1Tests,
  registerEnterpriseTier2Tests,
  registerEnterpriseTier3Tests,
  registerEnterpriseTier4Tests,
};

export function registerAllEnterpriseTests(
  collector: TestSuiteCollector,
  client: TestClient,
  credentials = { username: 'admin', password: 'password123' },
  devCredentials = { username: 'developer', password: 'password123' }
): void {
  registerEnterpriseTier1Tests(collector, client, credentials, devCredentials);
  registerEnterpriseTier2Tests(collector, client, credentials, devCredentials);
  registerEnterpriseTier3Tests(collector, client, credentials, devCredentials);
  registerEnterpriseTier4Tests(collector, client, credentials, devCredentials);
}
